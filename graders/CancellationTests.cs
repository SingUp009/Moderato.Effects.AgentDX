namespace AgentDx;

public sealed class CancellationTests
{
    [Fact]
    public async Task Load_ReusedEffect_CallsOperationOnEachRun()
    {
        // Given
        var calls = 0;
        var load = Submission.Load(_ => ValueTask.FromResult(++calls));
        Assert.Equal(0, calls);

        // When
        var first = await load.RunAsync(TestContext.Current.CancellationToken);
        var second = await load.RunAsync(TestContext.Current.CancellationToken);

        // Then
        Assert.True(first is Ok<int>(1));
        Assert.True(second is Ok<int>(2));
    }

    [Fact]
    public async Task Load_CallerCancels_OperationObservesCancellation()
    {
        // Given
        using var caller = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        var waiting = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var canceled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async ValueTask<int> Load(CancellationToken token)
        {
            using var registration = token.Register(() => canceled.TrySetResult());
            waiting.TrySetResult();
            await Task.Delay(Timeout.InfiniteTimeSpan, token).WaitAsync(TimeSpan.FromSeconds(5));
            return 1;
        }

        // When
        var run = Submission.Load(Load).RunExitAsync(caller.Token).AsTask();
        await waiting.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        caller.Cancel();
        var exit = await run.WaitAsync(TimeSpan.FromSeconds(6), TestContext.Current.CancellationToken);

        // Then
        Assert.True(exit is Interrupted);
        Assert.True(canceled.Task.IsCompletedSuccessfully);
    }

    [Fact]
    public async Task Load_OperationThrowsUnrelatedCancellation_PreservesDefect()
    {
        // Given
        var defect = new OperationCanceledException();

        // When
        var exit = await Submission.Load(_ => throw defect).RunExitAsync(TestContext.Current.CancellationToken);

        // Then
        Assert.True(exit is Die(var actual) && ReferenceEquals(defect, actual));
    }
}
