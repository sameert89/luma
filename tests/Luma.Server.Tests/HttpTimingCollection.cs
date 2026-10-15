namespace Luma.Server.Tests;

// Latency and scheduler-overlap assertions need the controlled load created by each
// test, rather than the unrelated archive/decoder work in other test collections.
[CollectionDefinition("HTTP timing", DisableParallelization = true)]
public sealed class HttpTimingCollection;
