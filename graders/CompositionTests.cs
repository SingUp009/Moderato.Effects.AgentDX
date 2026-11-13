using Microsoft.Extensions.Time.Testing;

namespace AgentDx;

public sealed class CompositionTests
{
    [Theory]
    [InlineData(0, false, 1)]
    [InlineData(2, false, 3)]
    [InlineData(3, false, 3)]
    [InlineData(1, true, 1)]
    public async Task Fetch_RequestFails_RetriesOnlyTransientErrorsWithinLimit(int failures, bool permanent, int expectedCalls)
    {
        // Given
        var calls = 0;
        var env = new Clock(new FakeTimeProvider());
        FetchError error = permanent ? new PermanentFetchError(410) : new TransientFetchError(503);
        var request = Effect<Clock>.FromResultAsync<int, FetchError>(_ =>
            ValueTask.FromResult<Result<int, FetchError>>(++calls <= failures ? new Err<FetchError>(error) : new Ok<int>(42)));

        // When
        var exit = await Submission.Fetch(request, TimeSpan.FromMinutes(1)).RunExitAsync(env, TestContext.Current.CancellationToken);

        // Then
        Assert.Equal(expectedCalls, calls);
        if (failures < calls)
            Assert.True(exit is Ok<int>(42));
        else
            Assert.True(exit is Err<FetchError>(var actual) && Equals(error.Value, actual.Value));
    }

    [Fact]
    public async Task Fetch_ZeroDeadline_SkipsTheRequest()
    {
        // Given
        var calls = 0;
        Effect<int, FetchError, Clock> request = Effect<Clock>.Sync(() => ++calls);

        // When
        var exit = await Submission.Fetch(request, TimeSpan.Zero)
            .RunExitAsync(new Clock(new FakeTimeProvider()), TestContext.Current.CancellationToken);

        // Then
        Assert.True(exit is Err<FetchError>(TimeoutError(var after)) && after == TimeSpan.Zero);
        Assert.Equal(0, calls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Fetch_SecondAttemptIsCanceled_AwaitsCleanupAndPreservesCause(bool callerCancels)
    {
        // Given
        using var caller = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        var clock = new FakeTimeProvider();
        var waiting = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var cleaning = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var finish = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        var deadline = TimeSpan.FromSeconds(10);
        var firstAttempt = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var request = Scope<FetchError, Clock>.Gen(async scope =>
        {
            if (++calls == 1)
            {
                await firstAttempt.Task.WaitAsync(TimeSpan.FromSeconds(5), scope.CancellationToken);
                throw scope.Fail(new TransientFetchError(503));
            }
            try
            {
                waiting.TrySetResult();
                await Task.Delay(Timeout.InfiniteTimeSpan, scope.CancellationToken).WaitAsync(TimeSpan.FromSeconds(5));
                return 42;
            }
            finally
            {
                cleaning.TrySetResult();
                await finish.Task.WaitAsync(TimeSpan.FromSeconds(5));
            }
        });

        // When
        var run = Submission.Fetch(request, deadline).RunExitAsync(new Clock(clock), caller.Token).AsTask();
        clock.Advance(TimeSpan.FromSeconds(6));
        firstAttempt.TrySetResult();
        try
        {
            await waiting.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            if (callerCancels)
                caller.Cancel();
            else
                clock.Advance(TimeSpan.FromSeconds(4));
            await cleaning.Task.WaitAsync(TimeSpan.FromSeconds(3), TestContext.Current.CancellationToken);
            Assert.False(run.IsCompleted);
        }
        finally
        {
            finish.TrySetResult();
        }
        var exit = await run.WaitAsync(TimeSpan.FromSeconds(6), TestContext.Current.CancellationToken);

        // Then
        Assert.Equal(2, calls);
        Assert.True(callerCancels
            ? exit is Interrupted
            : exit is Err<FetchError>(TimeoutError(var after)) && after == deadline);
    }

    private static TaskCompletionSource TaskCompletionSourceForRetry() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    private sealed record Clock(TimeProvider Service) : IHas<TimeProvider>;
}
