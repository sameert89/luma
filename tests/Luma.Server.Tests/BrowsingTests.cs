using System.Net;
using System.Net.Http.Json;
using Dapper;
using Luma.Server.Features.Media;
using Luma.Server.Features.Tags;
using Luma.Server.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Luma.Server.Tests;

public sealed class BrowsingTests
{
    [Fact]
    public async Task Keyset_pages_handle_ties_forward_backward_changed_limits_and_tampering()
    {
        await using var f=await PipelineFixture.CreateAsync();await SeedAsync(f,1001);
        var browser=await BrowserAsync(f);var query=new MediaQuery{Limit=37}.Normalize();
        var first=await browser.ListAsync(query,default);Assert.Null(first.PreviousCursor);
        var ids=new List<long>();var page=first;
        do
        {
            ids.AddRange(page.Items.Select(x=>x.Id));
            if(page.NextCursor is null) break;
            page=await browser.ListAsync(query with{Cursor=page.NextCursor},default);
        } while(true);
        Assert.Equal(Enumerable.Range(1,1001).Select(x=>(long)x).Reverse(),ids);
        var backward=await browser.ListAsync(query with{Cursor=page.PreviousCursor},default);
        Assert.Equal(Enumerable.Range(3,37).Select(x=>(long)x).Reverse(),backward.Items.Select(x=>x.Id));
        var changedLimit=await browser.ListAsync(query with{Limit=10,Cursor=first.NextCursor},default);
        Assert.Equal(964,changedLimit.Items[0].Id);
        var changedFilter=await Assert.ThrowsAsync<ApiRequestException>(()=>browser.ListAsync(new MediaQuery{Q="photo",Cursor=first.NextCursor}.Normalize(),default));
        Assert.Equal("invalid_cursor",changedFilter.Code);
        var tampered=first.NextCursor![..^8]+"tampered";
        Assert.Equal("invalid_cursor",(await Assert.ThrowsAsync<ApiRequestException>(()=>browser.ListAsync(query with{Cursor=tampered},default))).Code);
    }

    [Fact]
    public async Task Filters_combine_literal_unicode_text_dimensions_dates_preferences_and_tags()
    {
        await using var f=await PipelineFixture.CreateAsync();await SeedAsync(f,20);
        await using var db=await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Media SET FileName='Café 100%_Photo.JPG',RelativePath='Trips/Café 100%_Photo.JPG',Preference='liked' WHERE Id=2");
        var browser=await BrowserAsync(f);
        var tags=new TagService(f.Database);
        var vacation=(await tags.CreateAsync("Vacation",default)).Tag;
        var family=(await tags.CreateAsync("Family",default)).Tag;
        await tags.BulkAsync(new([2,4],[vacation.Id],[]),default);
        await tags.BulkAsync(new([2],[family.Id],[]),default);
        var matches=await browser.ListAsync(new MediaQuery{Q="cafe\u0301",Path="trips",StartsWith="CAFÉ",EndsWith=".jpg",Extension=["JPG"],Preference="liked",MinWidth=600,Height=960,
            MinAspectRatio=.6,MaxAspectRatio=.7,Orientation="portrait",Tag=["VACATION","family"],DateFrom="2025-12-31",DateTo="2026-01-02",MinSizeBytes=1024,MaxSizeBytes=3000}.Normalize(),default);
        Assert.Equal(2,Assert.Single(matches.Items).Id);
        Assert.Equal(2,Assert.Single((await browser.ListAsync(new MediaQuery{Q="100%_"}.Normalize(),default)).Items).Id);
        Assert.Empty((await browser.ListAsync(new MediaQuery{Tag=["unknown"]}.Normalize(),default)).Items);
        Assert.Equal(2,(await browser.ListAsync(new MediaQuery{Tag=["VACATION","unknown"],TagMode="any"}.Normalize(),default)).Items.Count);
        Assert.Equal(18,(await browser.ListAsync(new MediaQuery{Tagged=false}.Normalize(),default)).Items.Count);
        Assert.Equal(4,(await browser.ListAsync(new MediaQuery{MediaType="video"}.Normalize(),default)).Items.Count);
        Assert.Throws<ApiRequestException>(()=>new MediaQuery{Tagged=false,Tag=["Vacation"]}.Normalize());
        Assert.Throws<ApiRequestException>(()=>new MediaQuery{MinSizeBytes=20,MaxSizeBytes=10}.Normalize());
        Assert.Throws<ApiRequestException>(()=>new MediaQuery{MinAspectRatio=double.NaN}.Normalize());
    }

    [Fact]
    public async Task Recursive_folder_queries_and_neighbors_keep_the_same_filter()
    {
        await using var f=await PipelineFixture.CreateAsync();await SeedAsync(f,10);
        await using var db=await f.Database.OpenAsync(default);
        await db.ExecuteAsync("""
            INSERT INTO Folders(Id,LibraryId,ParentId,RelativePath,PathKey) VALUES(2,1,1,'child','child');
            INSERT INTO FolderAncestry VALUES(1,2),(2,2);
            UPDATE Media SET FolderId=2 WHERE Id<=5;
            """);
        var browser=await BrowserAsync(f);
        Assert.Equal(5,(await browser.ListAsync(new MediaQuery{FolderId=1}.Normalize(),default)).Items.Count);
        Assert.Equal(10,(await browser.ListAsync(new MediaQuery{FolderId=1,Recursive=true}.Normalize(),default)).Items.Count);
        var neighbors=await browser.NeighborsAsync(7,new MediaQuery{MediaType="image",FolderId=1}.Normalize(),default);
        Assert.Equal(8,neighbors.Previous!.Id);Assert.Equal(6,neighbors.Next!.Id);
        await Assert.ThrowsAsync<ApiRequestException>(()=>browser.ListAsync(new MediaQuery{LibraryId=2,FolderId=1}.Normalize(),default));
    }

    [Fact]
    public async Task Browsing_and_cache_work_with_sources_absent_and_missing_cache_only_queues_work()
    {
        await using var f=await PipelineFixture.CreateAsync();await f.CreateImageAsync("image.png");await f.ScanAsync();await f.ProcessAllAsync();
        await using var host=new WebApplicationFactory<Program>().WithWebHostBuilder(builder=>builder.UseEnvironment("Testing")
            .UseSetting("Luma:DatabasePath",f.Database.Path).UseSetting("Luma:Indexing:CachePath",f.Options.CachePath));
        using var client=host.CreateClient();
        Directory.Move(f.Root.Path,f.Root.Path+"-offline");
        await using var db=await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Libraries SET Enabled=1,Availability='unavailable'");
        var libraries=await client.GetAsync("/api/libraries");Assert.Equal(HttpStatusCode.OK,libraries.StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await client.GetAsync("/api/folders?libraryId=1")).StatusCode);
        var page=await client.GetFromJsonAsync<MediaPage>("/api/media");var media=Assert.Single(page!.Items);
        Assert.Equal(HttpStatusCode.OK,(await client.GetAsync($"/api/media/{media.Id}")).StatusCode);
        var content=await client.GetAsync(media.Preview.Url);Assert.Equal(HttpStatusCode.OK,content.StatusCode);
        Assert.Equal("image/jpeg",content.Content.Headers.ContentType?.MediaType);Assert.Contains("immutable",content.Headers.CacheControl!.ToString());
        using var conditional=new HttpRequestMessage(HttpMethod.Get,media.Preview.Url);conditional.Headers.IfNoneMatch.Add(content.Headers.ETag!);
        Assert.Equal(HttpStatusCode.NotModified,(await client.SendAsync(conditional)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync($"/api/media/{media.Id}/cache/99/preview?v=1")).StatusCode);
        var path=await db.ExecuteScalarAsync<string>("SELECT RelativePath FROM CacheEntries WHERE Variant='preview'");
        await File.WriteAllTextAsync(Path.Combine(f.Options.CachePath,path!),"corrupt");
        var missing=await client.GetAsync(media.Preview.Url);Assert.Equal(HttpStatusCode.ServiceUnavailable,missing.StatusCode);
        Assert.Contains("cache_unavailable",await missing.Content.ReadAsStringAsync());Assert.NotNull(missing.Headers.RetryAfter);
        await client.GetAsync(media.Preview.Url);
        Assert.Equal(1,await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ProcessingJobs"));
        Assert.Equal("pending",await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs"));
        var tag=await client.PostAsJsonAsync("/api/tags",new CreateTagRequest("Offline editing"));Assert.Equal(HttpStatusCode.Created,tag.StatusCode);
        var created=await tag.Content.ReadFromJsonAsync<TagSummary>();
        Assert.Equal(HttpStatusCode.NoContent,(await client.PostAsJsonAsync("/api/media/tags",new BulkTagsRequest([media.Id],[created!.Id],[]))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,(await client.PutAsJsonAsync($"/api/media/{media.Id}/preference",new PreferenceRequest("liked"))).StatusCode);
        Assert.Equal(media.Id,Assert.Single((await client.GetFromJsonAsync<MediaPage>("/api/media?tag=offline%20editing&preference=liked"))!.Items).Id);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.GetAsync("/api/media?unknown=1")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.GetAsync("/api/media?limit=0")).StatusCode);
    }

    [Fact]
    public async Task Unicode_tag_identity_and_bulk_limits_are_atomic_and_idempotent()
    {
        await using var f=await PipelineFixture.CreateAsync();await SeedAsync(f,500);var service=new TagService(f.Database);
        var first=await service.CreateAsync("  Café  ",default);var second=await service.CreateAsync("CAFE\u0301",default);
        Assert.Equal(first.Tag.Id,second.Tag.Id);Assert.Equal("Café",second.Tag.Name);Assert.False(second.Created);
        Assert.Equal((await service.CreateAsync("i",default)).Tag.Id,(await service.CreateAsync("I",default)).Tag.Id);
        Assert.NotEqual((await service.CreateAsync("İ",default)).Tag.Id,(await service.CreateAsync("i",default)).Tag.Id);
        Assert.NotEqual((await service.CreateAsync("ß",default)).Tag.Id,(await service.CreateAsync("ss",default)).Tag.Id);
        Assert.Throws<ApiRequestException>(()=>TagText.Normalize("\n"));Assert.Throws<ApiRequestException>(()=>TagText.Normalize(new string('a',101)));
        var all=Enumerable.Range(1,500).Select(x=>(long)x).ToArray();
        await service.BulkAsync(new(all,[first.Tag.Id],[]),default);await service.BulkAsync(new(all,[first.Tag.Id],[]),default);
        await using var db=await f.Database.OpenAsync(default);Assert.Equal(500,await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags"));
        await Assert.ThrowsAsync<ApiRequestException>(()=>service.BulkAsync(new([1,9999],[],[first.Tag.Id]),default));
        Assert.Equal(500,await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags"));
        var ids=new List<long>();for(var i=0;i<100;i++)ids.Add((await service.CreateAsync($"tag-{i}",default)).Tag.Id);
        await service.BulkAsync(new([1],ids.Take(50).ToArray(),[]),default);await service.BulkAsync(new([1],ids.Skip(50).Take(49).ToArray(),[]),default);
        Assert.Equal(100,await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags WHERE MediaId=1"));
        await Assert.ThrowsAsync<ApiRequestException>(()=>service.BulkAsync(new([1,2],[ids[^1]],[]),default));
        Assert.Equal(0,await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags WHERE TagId=@id",new{id=ids[^1]}));
    }

    private static async Task<MediaBrowser> BrowserAsync(PipelineFixture f)
    {var signer=new CursorSigner(f.Database);await signer.InitializeAsync(default);return new(f.Database,signer);}
    private static async Task SeedAsync(PipelineFixture f,int count)
    {
        await f.ScanAsync();await using var db=await f.Database.OpenAsync(default);
        await db.ExecuteAsync("""
            WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<@count)
            INSERT INTO Media(Id,LibraryId,FolderId,RelativePath,PathKey,FileName,MediaType,MimeType,Extension,SizeBytes,ModifiedAt,IndexedAt,EffectiveDate,LastSeenScanId,Width,Height)
            SELECT x,1,1,'photo-'||x||'.jpg','photo-'||x||'.jpg','photo-'||x||'.jpg',CASE WHEN x%5=0 THEN 'video' ELSE 'image' END,'image/jpeg','.jpg',x*1024,
              '2026-01-01T00:00:00.0000000Z','2026-01-01T00:00:00.0000000Z','2026-01-01T00:00:00.0000000Z',1,640,960 FROM n
            """,new{count});
    }
}
