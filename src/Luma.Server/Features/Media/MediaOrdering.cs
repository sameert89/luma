using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using Luma.Server.Http;

namespace Luma.Server.Features.Media;

// All SQL expressions originate from the validated query allowlist.
public sealed class MediaOrdering(MediaQuery query)
{
    public long Pivot { get; } = BitConverter.ToInt64(SHA256.HashData(Encoding.UTF8.GetBytes(query.Seed ?? "")),0) & long.MaxValue;
    public string GroupExpression => query.GroupBy switch {
        "folder" => "m.FolderId", "date" => "m.DateDay", "type" => "m.TypeKey", _ => "0" };
    public string KeyExpression => query.Sort switch {
        "captured" => "m.EffectiveTicks", "name" => "m.NameKey", "type" => "m.MediaType", "size" => "m.SizeBytes", "shuffle" => "m.RandomKey", _ => "m.ModifiedTicks" };
    private (string Sql, bool Ascending, bool Text)[] Terms =>
        (query.GroupBy == "none" ? Array.Empty<(string,bool,bool)>() : [(GroupExpression,true,false)])
        .Concat(query.Sort == "shuffle" ? new[] { ($"CASE WHEN m.RandomKey>={Pivot} THEN 0 ELSE 1 END",true,false) } : [])
        .Concat(new[] { (KeyExpression,query.Sort == "shuffle" || query.Order == "asc",query.Sort is "name" or "type"), ("m.Id",query.Sort == "shuffle" || query.Order == "asc",false) }).ToArray();
    public string Order(bool backward) => string.Join(",",Terms.Select(t => t.Sql + ((t.Ascending != backward) ? " ASC" : " DESC")));
    public string Seek(CursorPosition position, DynamicParameters p, bool backward)
    {
        var terms=Terms;
        var values=position.Tuple ?? (query.Sort == "modified" && query.GroupBy == "none" ? [position.Ticks.ToString(CultureInfo.InvariantCulture),position.Id.ToString(CultureInfo.InvariantCulture)] : null);
        if(values is null || values.Length != terms.Length) throw new ApiRequestException(400,"invalid_cursor","Refresh the results.");
        for(var i=0;i<terms.Length;i++) {
            if(terms[i].Text) p.Add("seek"+i,values[i]);
            else if(long.TryParse(values[i],CultureInfo.InvariantCulture,out var number)) p.Add("seek"+i,number);
            else throw new ApiRequestException(400,"invalid_cursor","Refresh the results.");
        }
        if(terms.All(t=>t.Ascending==terms[0].Ascending))
            return "("+string.Join(",",terms.Select(t=>t.Sql))+")"+((terms[0].Ascending != backward)?">":"<")+"("+string.Join(",",terms.Select((_,i)=>"@seek"+i))+")";
        return "(" + string.Join(" OR ",terms.Select((t,i) => "(" + string.Join(" AND ",terms.Take(i).Select((equal,j)=>equal.Sql+"=@seek"+j).Append(t.Sql+((t.Ascending != backward)?">":"<")+"@seek"+i)) + ")")) + ")";
    }
    public string[] Tuple(MediaRow row)
    {
        var values=new List<object>();
        if(query.GroupBy != "none") values.Add(query.GroupBy switch { "folder"=>row.FolderId,"date"=>row.EffectiveTicks/864000000000,"type"=>row.MediaType=="image"?0L:1L,_=>0L });
        if(query.Sort == "shuffle") values.Add(row.RandomKey>=Pivot?0L:1L);
        values.Add(query.Sort switch { "captured" => row.EffectiveTicks, "name" => row.NameKey, "type" => row.MediaType, "size" => row.SizeBytes, "shuffle" => row.RandomKey, _ => (object)row.ModifiedTicks });
        values.Add(row.Id);
        return values.Select(x=>Convert.ToString(x,CultureInfo.InvariantCulture)!).ToArray();
    }
    public string? GroupKey(MediaRow row) => query.GroupBy switch {
        "folder" => "folder:"+row.FolderId, "date"=>row.EffectiveDate[..10], "type"=>row.MediaType, _=>null };
}
