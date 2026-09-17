using System.Text;
using System.Diagnostics;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats;
using SixLabors.ImageSharp.Memory;
using SixLabors.ImageSharp.Metadata.Profiles.Exif;

namespace Luma.Server.Features.Tags;

public static class MetadataKeywords
{
    public const int MaximumMetadataBytes = 4 * 1024 * 1024;
    private static readonly XNamespace Dc = "http://purl.org/dc/elements/1.1/";
    private static readonly XNamespace Rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

    public static async Task<IReadOnlyList<string>> ReadImageProcessAsync(string path,CancellationToken ct)
    {
        using var process=new Process { StartInfo=new ProcessStartInfo("dotnet") {
            UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true } };
        process.StartInfo.ArgumentList.Add(typeof(MetadataKeywords).Assembly.Location);
        process.StartInfo.ArgumentList.Add("--read-tags");
        process.StartInfo.ArgumentList.Add(path);
        process.StartInfo.Environment["DOTNET_GCHeapHardLimit"]="0x08000000";
        process.Start();
        using var kill=ct.Register(()=>{try {process.Kill(true);} catch(InvalidOperationException) {}});
        var stderr=process.StandardError.BaseStream.CopyToAsync(Stream.Null,ct);
        using var output=new MemoryStream();
        var buffer=new byte[8192];
        try {
            int read;
            while((read=await process.StandardOutput.BaseStream.ReadAsync(buffer,ct))>0) {
                if(output.Length+read>MaximumMetadataBytes) throw new InvalidDataException();
                await output.WriteAsync(buffer.AsMemory(0,read),ct);
            }
            await process.WaitForExitAsync(ct); await stderr;
            if(process.ExitCode!=0) throw new InvalidDataException();
            return JsonSerializer.Deserialize<string[]>(output.ToArray()) ?? [];
        } finally {
            if(!process.HasExited) {process.Kill(true);await process.WaitForExitAsync(CancellationToken.None);}
        }
    }

    public static IReadOnlyList<string> ReadXmp(byte[] bytes)
    {
        if(bytes.Length > MaximumMetadataBytes) throw new InvalidDataException();
        using var stream = new MemoryStream(bytes);
        using var reader = XmlReader.Create(stream,new XmlReaderSettings {
            DtdProcessing=DtdProcessing.Prohibit, XmlResolver=null, MaxCharactersInDocument=MaximumMetadataBytes });
        var document=XDocument.Load(reader);
        return document.Descendants(Dc+"subject").SelectMany(x=>x.Descendants(Rdf+"li")).Select(x=>x.Value).ToArray();
    }

    // A bounded head/tail scan for an embedded XMP packet: XMP is self-delimiting by
    // convention (the <?xpacket begin=?>...<?xpacket end=?> wrapper), which is how
    // readers locate one in an arbitrary container without parsing its internal boxes.
    // Cameras and editors usually place it near the front or back of the file, so two
    // bounded windows cover it without reading the whole (possibly very large) video.
    private const int XmpScanWindowBytes = 8 * 1024 * 1024;
    private static readonly byte[] XpacketBegin = Encoding.ASCII.GetBytes("<?xpacket begin=");
    private static readonly byte[] XpacketEnd = Encoding.ASCII.GetBytes("<?xpacket end=");

    public static async Task<IReadOnlyList<string>> ReadEmbeddedXmpPacketAsync(string path,CancellationToken ct)
    {
        await using var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read,65536,FileOptions.Asynchronous|FileOptions.SequentialScan);
        var length=stream.Length;
        var packet=ExtractXmpPacket(await ReadWindowAsync(stream,0,Math.Min(length,XmpScanWindowBytes),ct));
        if(packet is null && length>XmpScanWindowBytes)
            packet=ExtractXmpPacket(await ReadWindowAsync(stream,length-XmpScanWindowBytes,XmpScanWindowBytes,ct));
        return packet is null?[]:ReadXmp(packet);
    }

    private static async Task<byte[]> ReadWindowAsync(FileStream stream,long offset,long length,CancellationToken ct)
    {
        stream.Seek(offset,SeekOrigin.Begin);
        var buffer=new byte[length];
        await stream.ReadExactlyAsync(buffer,ct);
        return buffer;
    }

    private static byte[]? ExtractXmpPacket(byte[] window)
    {
        var span=window.AsSpan();
        var start=span.IndexOf(XpacketBegin);
        if(start<0) return null;
        var endMarker=span[start..].IndexOf(XpacketEnd);
        if(endMarker<0) return null;
        endMarker+=start;
        var closing=span[endMarker..].IndexOf("?>"u8);
        if(closing<0) return null;
        var end=endMarker+closing+2;
        return end-start>MaximumMetadataBytes?null:window[start..end];
    }

    public static byte[] WriteXmp(IEnumerable<string> tags)
    {
        XNamespace x="adobe:ns:meta/";
        var document=new XDocument(new XElement(x+"xmpmeta",new XAttribute(XNamespace.Xmlns+"x",x),
            new XElement(Rdf+"RDF",new XAttribute(XNamespace.Xmlns+"rdf",Rdf),
                new XElement(Rdf+"Description",new XAttribute(Rdf+"about",""),new XAttribute(XNamespace.Xmlns+"dc",Dc),
                    new XElement(Dc+"subject",new XElement(Rdf+"Bag",tags.Select(tag=>new XElement(Rdf+"li",tag))))))));
        return Encoding.UTF8.GetBytes(document.ToString());
    }

    public static async Task<IReadOnlyList<string>> ReadImageAsync(string path,CancellationToken ct)
    {
        var configuration=Configuration.Default.Clone();
        configuration.MaxDegreeOfParallelism=1;
        configuration.MemoryAllocator=MemoryAllocator.Create(new MemoryAllocatorOptions { MaximumPoolSizeMegabytes=8,AllocationLimitMegabytes=32 });
        var info=await Image.IdentifyAsync(new DecoderOptions { Configuration=configuration,MaxFrames=1 },path,ct);
        var keywords=new List<string>();
        if(info.Metadata.XmpProfile is { } xmp) keywords.AddRange(ReadXmp(xmp.ToByteArray()));
        if(info.Metadata.ExifProfile?.TryGetValue(ExifTag.XPKeywords,out var exif)==true)
            keywords.AddRange((exif.Value ?? "").TrimEnd('\0').Split(';',StringSplitOptions.TrimEntries|StringSplitOptions.RemoveEmptyEntries));
        return keywords;
    }
}
