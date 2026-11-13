namespace AgentDx;

public sealed class DependenciesTests
{
    [Fact]
    public async Task Quote_ReusedWithDifferentEnvironments_UsesEachSuppliedRate()
    {
        // Given
        var first = new Rates(1.25m);
        var second = new Rates(2m);
        var quote = Submission.Quote<Env>("EUR", 4);
        Assert.Equal(0, first.Calls);
        Assert.Equal(0, second.Calls);

        // When
        var before = await quote.RunAsync(new Env(first), TestContext.Current.CancellationToken);
        var after = await quote.RunAsync(new Env(second), TestContext.Current.CancellationToken);

        // Then
        Assert.True(before is Ok<decimal>(5m));
        Assert.True(after is Ok<decimal>(8m));
        Assert.Equal(1, first.Calls);
        Assert.Equal(1, second.Calls);
    }

    [Fact]
    public async Task Quote_RateUnavailable_PreservesTypedError()
    {
        // Given
        var rates = new Rates(1m);

        // When
        var result = await Submission.Quote<Env>("JPY", 2).RunAsync(new Env(rates), TestContext.Current.CancellationToken);

        // Then
        Assert.True(result is Err<RateFailure>(RateFailure("JPY")));
    }

    [Fact]
    public async Task Quote_RateLookupCanceled_PassesCancellationToService()
    {
        // Given
        using var caller = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        var rates = new Rates(1m);

        // When
        var run = Submission.Quote<Env>("wait", 2).RunExitAsync(new Env(rates), caller.Token).AsTask();
        await rates.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        caller.Cancel();
        var exit = await run.WaitAsync(TimeSpan.FromSeconds(6), TestContext.Current.CancellationToken);

        // Then
        Assert.True(exit is Interrupted);
        Assert.True(rates.ObservedToken.IsCancellationRequested);
    }

    private sealed record Env(IRateSource Service) : IHas<IRateSource>;

    private sealed class Rates(decimal rate) : IRateSource
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Calls { get; private set; }
        public CancellationToken ObservedToken { get; private set; }

        public async ValueTask<Result<decimal, RateFailure>> Rate(string currency, CancellationToken cancellationToken)
        {
            Calls++;
            ObservedToken = cancellationToken;
            Entered.TrySetResult();
            if (currency == "wait")
                await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken).WaitAsync(TimeSpan.FromSeconds(5));
            if (currency == "EUR")
                return new Ok<decimal>(rate);
            return new Err<RateFailure>(new RateFailure(currency));
        }
    }
}
