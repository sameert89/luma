using Luma.Server.Features.Files;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;

namespace Luma.Server.Tests;

public sealed class MutationSafetyTests
{
    [Theory]
    [InlineData("../outside")]
    [InlineData("/absolute")]
    [InlineData("C:/Windows")]
    [InlineData("folder\\outside")]
    [InlineData("a//b")]
    [InlineData("a/./b")]
    [InlineData("a/../b")]
    [InlineData(".LUMA-TRASH/item")]
    [InlineData("a/.luma-uploads/item")]
    [InlineData("a/.luma-operations/item")]
    [InlineData("CON.txt")]
    [InlineData("trailing.")]
    [InlineData("trailing ")]
    [InlineData("")]
    public void Unsafe_paths_are_rejected(string path) => Assert.Throws<ApiRequestException>(() => MutationPaths.Normalize(path));

    [Fact]
    public void New_destination_is_allowed_but_link_ancestors_are_rejected()
    {
        var directory = Path.Combine(Path.GetTempPath(), "luma-path-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var root = new LibraryOptions { Id = 1, Path = directory };
            Assert.Equal(Path.Combine(directory, "new", "image.jpg"), MutationPaths.Resolve(root, "new/image.jpg"));
            if (!OperatingSystem.IsWindows())
            {
                Directory.CreateSymbolicLink(Path.Combine(directory, "link"), Path.GetTempPath());
                Assert.Throws<ApiRequestException>(() => MutationPaths.Resolve(root, "link/new.jpg"));
                File.CreateSymbolicLink(Path.Combine(directory, "dangling"), Path.Combine(directory, "missing"));
                Assert.Throws<ApiRequestException>(() => MutationPaths.Resolve(root, "dangling"));
            }
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public void Traversal_excludes_private_staging_on_case_sensitive_filesystems_too()
    {
        var directory = Path.Combine(Path.GetTempPath(), "luma-traversal-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            foreach (var name in new[] { ".luma-trash", ".LUMA-UPLOADS", ".luma-operations", "photos" })
            {
                Directory.CreateDirectory(Path.Combine(directory, name));
                File.WriteAllText(Path.Combine(directory, name, "image.jpg"), "test");
            }
            var entries = SourceTraversal.Enumerate(directory).ToArray();
            Assert.Equal(2, entries.Length);
            Assert.All(entries, entry => Assert.Contains("photos", entry.FullName));
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public void Writes_require_long_configured_token_and_same_origin()
    {
        var token = new string('x', 48);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Luma:Files:AccessToken"] = token }).Build();
        var access = new MutationAccess(configuration);
        var context = new DefaultHttpContext();
        context.Request.Scheme = "https";
        context.Request.Host = new HostString("luma.example");
        Assert.Equal(401, Assert.Throws<ApiRequestException>(() => access.Authorize(context)).Status);
        context.Request.Headers.Authorization = "Bearer " + token;
        access.Authorize(context);
        context.Request.Headers.Origin = "https://evil.example";
        Assert.Equal(403, Assert.Throws<ApiRequestException>(() => access.Authorize(context)).Status);
        context.Request.Headers.Origin = "https://luma.example";
        access.Authorize(context);
        context.Request.Headers["Sec-Fetch-Site"] = "cross-site";
        Assert.Equal(403, Assert.Throws<ApiRequestException>(() => access.Authorize(context)).Status);
        var disabled = new MutationAccess(new ConfigurationBuilder().Build());
        Assert.False(disabled.Enabled);
        context.Request.Headers.Remove("Sec-Fetch-Site");
        Assert.Equal(401, Assert.Throws<ApiRequestException>(() => disabled.Authorize(context)).Status);
    }

    [Fact]
    public void Weak_tokens_fail_closed_and_libraries_default_to_read_only()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Luma:Files:AccessToken"] = "weak" }).Build();
        Assert.Throws<InvalidOperationException>(() => new MutationAccess(configuration));
        Assert.False(new LibraryOptions().Writable);
    }
    [Fact]
    public void Browser_same_origin_metadata_accepts_tls_termination_without_allowing_cross_site_requests()
    {
        var context = new Microsoft.AspNetCore.Http.DefaultHttpContext();
        context.Request.Scheme = "http";
        context.Request.Host = new("luma:5080");
        context.Request.Headers.Origin = "https://photos.example.com";
        context.Request.Headers["Sec-Fetch-Site"] = "same-origin";
        MutationAccess.CheckOrigin(context.Request);
        context.Request.Headers["Sec-Fetch-Site"] = "cross-site";
        Assert.Throws<Luma.Server.Http.ApiRequestException>(() => MutationAccess.CheckOrigin(context.Request));
        context.Request.Headers.Remove("Sec-Fetch-Site");
        Assert.Throws<Luma.Server.Http.ApiRequestException>(() => MutationAccess.CheckOrigin(context.Request));
    }
}
