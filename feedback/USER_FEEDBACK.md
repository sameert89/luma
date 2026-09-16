# Stage 3

- Was able to successfully run the project, although clearer instructions towards the front of the README would be appreciated, had to run asp net core backend and frontend separately
- Could not verify docker, no Dockerfiles/docker-compose.yaml was found
- The ui was verified on desktop and mobile
- Do not like the font being used, roboto or inter would be preferred, maybe this needs to be added in product requirements
- Svgs are manually drawn which makes it a nighmare to maintain, a dependency could be justifiable here
- Did not find git tracking being done periodically

## Addressed in stages 4–5

- Added a Docker quick start at the front of README plus a single-service Dockerfile and Compose configuration.
- Rewrote local development startup as two numbered terminals and explained why both processes run.
- Switched the interface to locally bundled Inter and recorded it in the product contract.
- Replaced maintained SVG path markup with Lucide React icons.
- Added checkpoint commits after the stage 3 baseline and stage 4 backend before continuing the UI and verification work.

# Stage 4

- The UI is totally terrible, and needs a complete redesign to improve usability and aesthetics.
- We have prepared mockups for the same and palced it in mockups folder
- Tested docker application with a real dataset mount of 100 thousand images, the obvious issue was that the user did not get any indication on the first scan, they were just put on an all media screen with a tiny side text showing scan is in progress.
  Scanning · 64031 found · 141 ready, What is found and what is ready is not clear to the user
- The home being all media which lists all media flat, is not something put in requirements, we need to explicitly update it that we only show libraries as the homepage.
- Moreover there is a bug during scanning, the all files page mentioned failed to load preview when clicked upon images, which makes user confused on what to do, the retry preview does nothing
- Bunch of dapper related errors in logs
  --- End of stack trace from previous location ---
  luma-1 | at Microsoft.AspNetCore.Diagnostics.StatusCodePagesMiddleware.Invoke(HttpContext context)
  luma-1 | at Microsoft.AspNetCore.Diagnostics.ExceptionHandlerMiddlewareImpl.<Invoke>g**Awaited|10*0(ExceptionHandlerMiddlewareImpl middleware, HttpContext context, Task task)
  luma-1 | fail: Luma.Server.Http.ApiExceptionHandler[0]
  luma-1 | Request failed with trace 0HNOJC0D47HG9:0000005B
  luma-1 | Microsoft.Data.Sqlite.SqliteException (0x80004005): SQLite Error 5: 'database is locked'.
  luma-1 | at Microsoft.Data.Sqlite.SqliteDataReader.NextResult()
  luma-1 | at Microsoft.Data.Sqlite.SqliteCommand.ExecuteReader(CommandBehavior behavior)
  luma-1 | at System.Data.Common.DbCommand.ExecuteNonQueryAsync(CancellationToken cancellationToken)
  luma-1 | --- End of stack trace from previous location ---
  luma-1 | at Dapper.SqlMapper.ExecuteImplAsync(IDbConnection cnn, CommandDefinition command, Object param) in /*/Dapper/SqlMapper.Async.cs:line 663
  luma-1 | at Luma.Server.Features.Media.CacheContent.QueueAsync(Int64 id, Int64 revision, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 48
  luma-1 | at Luma.Server.Features.Media.CacheContent.QueueAsync(Int64 id, Int64 revision, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 48
  luma-1 | at Luma.Server.Features.Media.CacheContent.ServeAsync(Int64 id, Int64 revision, String variant, Nullable`1 v, HttpContext context, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 41
luma-1  |          at Luma.Server.Features.Media.CacheContent.ServeAsync(Int64 id, Int64 revision, String variant, Nullable`1 v, HttpContext context, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 43
  luma-1 | at Luma.Server.Features.Media.MediaEndpoints.<>c.<<MapMedia>b**0*5>d.MoveNext() in /build/src/Luma.Server/Features/Media/MediaEndpoints.cs:line 20
  luma-1 | --- End of stack trace from previous location ---
  luma-1 | at Microsoft.AspNetCore.Http.RequestDelegateFactory.ExecuteTaskResult[T](Task`1 task, HttpContext httpContext)
  luma-1 | at Program.<>c.<<<Main>$>b**0_7>d.MoveNext() in /build/src/Luma.Server/Program.cs:line 70
  luma-1 | --- End of stack trace from previous location ---
  luma-1 | at Microsoft.AspNetCore.Diagnostics.StatusCodePagesMiddleware.Invoke(HttpContext context)
  luma-1 | at Microsoft.AspNetCore.Diagnostics.ExceptionHandlerMiddlewareImpl.<Invoke>g**Awaited|10_0(ExceptionHandlerMiddlewareImpl middleware, HttpContext context, Task task)
  luma-1 | fail: Luma.Server.Http.ApiExceptionHandler[0]
  luma-1 | Request failed with trace 0HNOJC0D47HGB:00000037
  luma-1 | Microsoft.Data.Sqlite.SqliteException (0x80004005): SQLite Error 5: 'database is locked'.
  luma-1 | at Microsoft.Data.Sqlite.SqliteDataReader.NextResult()
  luma-1 | at Microsoft.Data.Sqlite.SqliteCommand.ExecuteReader(CommandBehavior behavior)
  luma-1 | at System.Data.Common.DbCommand.ExecuteNonQueryAsync(CancellationToken cancellationToken)
  luma-1 | --- End of stack trace from previous location ---
  luma-1 | at Dapper.SqlMapper.ExecuteImplAsync(IDbConnection cnn, CommandDefinition command, Object param) in /*/Dapper/SqlMapper.Async.cs:line 663
  luma-1 | at Luma.Server.Features.Media.CacheContent.QueueAsync(Int64 id, Int64 revision, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 48
  luma-1 | at Luma.Server.Features.Media.CacheContent.QueueAsync(Int64 id, Int64 revision, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 48
  luma-1 | at Luma.Server.Features.Media.CacheContent.ServeAsync(Int64 id, Int64 revision, String variant, Nullable`1 v, HttpContext context, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 41
luma-1  |          at Luma.Server.Features.Media.CacheContent.ServeAsync(Int64 id, Int64 revision, String variant, Nullable`1 v, HttpContext context, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 43
  luma-1 | at Luma.Server.Features.Media.MediaEndpoints.<>c.<<MapMedia>b**0_5>d.MoveNext() in /build/src/Luma.Server/Features/Media/MediaEndpoints.cs:line 20
  luma-1 | --- End of stack trace from previous location ---
  luma-1 | at Microsoft.AspNetCore.Http.RequestDelegateFactory.ExecuteTaskResult[T](Task`1 task, HttpContext httpContext)
  luma-1 | at Program.<>c.<<<Main>$>b**0*7>d.MoveNext() in /build/src/Luma.Server/Program.cs:line 70
  luma-1 | --- End of stack trace from previous location ---
  luma-1 | at Microsoft.AspNetCore.Diagnostics.StatusCodePagesMiddleware.Invoke(HttpContext context)
  luma-1 | at Microsoft.AspNetCore.Diagnostics.ExceptionHandlerMiddlewareImpl.<Invoke>g\_\_Awaited|10_0(ExceptionHandlerMiddlewareImpl middleware, HttpContext context, Task task)
  luma-1 | fail: Luma.Server.Http.ApiExceptionHandler[0]
  luma-1 | Request failed with trace 0HNOJC0D47HGG:0000003B
  luma-1 | Microsoft.Data.Sqlite.SqliteException (0x80004005): SQLite Error 5: 'database is locked'.
  luma-1 | at Microsoft.Data.Sqlite.SqliteDataReader.NextResult()
  luma-1 | at Microsoft.Data.Sqlite.SqliteCommand.ExecuteReader(CommandBehavior behavior)
  luma-1 | at System.Data.Common.DbCommand.ExecuteNonQueryAsync(CancellationToken cancellationToken)
  luma-1 | --- End of stack trace from previous location ---
  luma-1 | at Dapper.SqlMapper.ExecuteImplAsync(IDbConnection cnn, CommandDefinition command, Object param) in /*/Dapper/SqlMapper.Async.cs:line 663
  luma-1 | at Luma.Server.Features.Media.CacheContent.QueueAsync(Int64 id, Int64 revision, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 48
  luma-1 | at Luma.Server.Features.Media.CacheContent.QueueAsync(Int64 id, Int64 revision, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 48
  luma-1 | at Luma.Server.Features.Media.CacheContent.ServeAsync(Int64 id, Int64 revision, String variant, Nullable`1 v, HttpContext context, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 41
luma-1  |          at Luma.Server.Features.Media.CacheContent.ServeAsync(Int64 id, Int64 revision, String variant, Nullable`1 v, HttpContext context, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 43
  luma-1 | at Luma.Server.Features.Media.MediaEndpoints.<>c.<<MapMedia>b**0_5>d.MoveNext() in /build/src/Luma.Server/Features/Media/MediaEndpoints.cs:line 20
  luma-1 | --- End of stack trace from previous location ---
  luma-1 | at Microsoft.AspNetCore.Http.RequestDelegateFactory.ExecuteTaskResult[T](Task`1 task, HttpContext httpContext)
  luma-1 | at Program.<>c.<<<Main>$>b**0*7>d.MoveNext() in /build/src/Luma.Server/Program.cs:line 70
  luma-1 | --- End of stack trace from previous location ---
  luma-1 | at Microsoft.AspNetCore.Diagnostics.StatusCodePagesMiddleware.Invoke(HttpContext context)
  luma-1 | at Microsoft.AspNetCore.Diagnostics.ExceptionHandlerMiddlewareImpl.<Invoke>g\_\_Awaited|10_0(ExceptionHandlerMiddlewareImpl middleware, HttpContext context, Task task)
  luma-1 | fail: Luma.Server.Http.ApiExceptionHandler[0]
  luma-1 | Request failed with trace 0HNOJC0D47HG9:000000B1
  luma-1 | Microsoft.Data.Sqlite.SqliteException (0x80004005): SQLite Error 5: 'database is locked'.
  luma-1 | at Microsoft.Data.Sqlite.SqliteDataReader.NextResult()
  luma-1 | at Microsoft.Data.Sqlite.SqliteCommand.ExecuteReader(CommandBehavior behavior)
  luma-1 | at System.Data.Common.DbCommand.ExecuteNonQueryAsync(CancellationToken cancellationToken)
  luma-1 | --- End of stack trace from previous location ---
  luma-1 | at Dapper.SqlMapper.ExecuteImplAsync(IDbConnection cnn, CommandDefinition command, Object param) in /*/Dapper/SqlMapper.Async.cs:line 663
  luma-1 | at Luma.Server.Features.Media.CacheContent.QueueAsync(Int64 id, Int64 revision, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 48
  luma-1 | at Luma.Server.Features.Media.CacheContent.QueueAsync(Int64 id, Int64 revision, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 48
  luma-1 | at Luma.Server.Features.Media.CacheContent.ServeAsync(Int64 id, Int64 revision, String variant, Nullable`1 v, HttpContext context, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 41
luma-1  |          at Luma.Server.Features.Media.CacheContent.ServeAsync(Int64 id, Int64 revision, String variant, Nullable`1 v, HttpContext context, CancellationToken ct) in /build/src/Luma.Server/Features/Media/CacheContent.cs:line 43
  luma-1 | at Luma.Server.Features.Media.MediaEndpoints.<>c.<<MapMedia>b**0_5>d.MoveNext() in /build/src/Luma.Server/Features/Media/MediaEndpoints.cs:line 20
  luma-1 | --- End of stack trace from previous location ---
  luma-1 | at Microsoft.AspNetCore.Http.RequestDelegateFactory.ExecuteTaskResult[T](Task`1 task, HttpContext httpContext)
  luma-1 | at Program.<>c.<<<Main>$>b**0_7>d.MoveNext() in /build/src/Luma.Server/Program.cs:line 70
  luma-1 | --- End of stack trace from previous location ---
  luma-1 | at Microsoft.AspNetCore.Diagnostics.StatusCodePagesMiddleware.Invoke(HttpContext context)
  luma-1 | at Microsoft.AspNetCore.Diagnostics.ExceptionHandlerMiddlewareImpl.<Invoke>g\_\_Awaited|10_0(ExceptionHandlerMiddlewareImpl middleware, HttpContext context, Task task)
  luma-1 | fail: Luma.Server.Http.ApiExceptionHandler[0]
  luma-1 | Request failed with trac

- Your originals stay untouched.
  Tags and preferences live in Luma. This line is not required to be mentioned to the user on the homescreen, it could be put in a specific about/help section when it is developed, but the requirements do not state this

- The search functionality is broken as well

- The lack of animations makes it abysmally dull and unengaging, although it is not an explicit requirement, but since its CSR, we could have a better user experience with some subtle animations while still meeting the performance on the server

- Original availability
  present, what is this field that is being shown on media information for? Originals are the source of truth, if they do not exist then the media information should reflect that accordingly and not show up on luma, This requires careful engineering on how to keep the two in sync without having to rescan everything all the time, perhaps a lazy cleanup supported by an adr.

- While the scan was at about 80%, many folders in the library appeared empty, despite clearly having content. Actually this was true for most folders, at 80% you'd think that most of them are loaded, but only a couple were visible initiallly

- The behaviour of cancelling the scan should be clearly documented, could it leave the user stranded with corrupt db, can it be resumed if it shut off?

- Scan complete · 177042 found · 366 ready

This ready counter seems to go up 1 per second, at this rate it would take over 2 days to complete, and this is on a modern i5 11th gen CPU and plenty of RAM, this is a critical issue and its unacceptable

- Bunch of 503 errors observed
  GET http://localhost:5080/api/media/174185/cache/1/thumbnail?v=1

GET http://localhost:5080/api/media/174184/cache/1/thumbnail?v=1

GET http://localhost:5080/api/media/174183/cache/1/thumbnail?v=1

GET http://localhost:5080/api/media/174182/cache/1/thumbnail?v=1

GET http://localhost:5080/api/media/174181/cache/1/thumbnail?v=1

GET http://localhost:5080/api/media/174180/cache/1/thumbnail?v=1

GET http://localhost:5080/api/media/174179/cache/1/thumbnail?v=1

- Videos are outright broken and would not play at all


# Stage 6
On an actual phone basically any popup is not loading at all, it becomes a black/white
  screen when clicked, this includes filters, photo viewer etc. On desktop everything works
  fine, I also want to make the fit/fill controls stick for the viewing experience and not
  just be on one media only. We also found that luma header is taking a lot of space on
  reels, we can have it draw the logo over the viewer like instagram and tiktok do,
  something creative like luma logo with reels icon on the side in superscript. The bottom
  player options also eat the crucial media display space, maybe hide them behind a menu as
  well I would say, the media controls arent styled at all and just use the browser media
  controls which look ugly, the auto scroll is confusing, remove those options, just have a
  nice icon button for auto scroll I dont need those optiosn inside an ugly rectangle. in
  the bottom player, Open original and Download are just random hyper links while others
  popup as proper buttons, why arent those themed? I also don't need an open original
  option. Full screen just full screens the video, what about the UI, the floating on top UI
  should also be there on reels, it makes sense on normal player if I am viewing longer
  videos though.