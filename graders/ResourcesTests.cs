namespace AgentDx;

public sealed class ResourcesTests
{
    [Theory]
    [InlineData("success")]
    [InlineData("error")]
    [InlineData("defect")]
    [InlineData("cancellation")]
    public async Task Read_AcquiredLease_AwaitsOneCloseWithActualExit(string outcome)
    {
        // Given
        using var caller = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        var lease = new Lease(outcome);
        var opens = 0;
        var effect = Submission.Read(() =>
        {
            opens++;
            return lease;
        });
        Assert.Equal(0, opens);

        // When
        var run = effect.RunExitAsync(caller.Token).AsTask();
        try
        {
            await lease.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            if (outcome == "cancellation")
                caller.Cancel();
            await lease.Closing.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            Assert.False(run.IsCompleted);
        }
        finally
        {
            lease.AllowClose.TrySetResult();
        }
        var exit = await run.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);

        // Then
        Assert.Equal(1, opens);
        Assert.Equal(1, lease.Reads);
        Assert.Equal(1, lease.Closes);
        Assert.False(lease.CloseToken.IsCancellationRequested);
        Assert.True(outcome switch
        {
            "success" => exit is Ok<int>(17) && lease.Exit is Succeeded,
            "error" => exit is Err<ReadFailure>(ReadFailure("unavailable")) && lease.Exit is Failed(ReadFailure("unavailable")),
            "defect" => exit is Die(var defect) && lease.Exit is Die(var closeDefect) && ReferenceEquals(defect, closeDefect),
            _ => exit is Interrupted && lease.Exit is Interrupted,
        });
    }

    [Fact]
    public async Task Read_AcquisitionThrows_PreservesDefect()
    {
        // Given
        var defect = new IOException("open failed");

        // When
        var exit = await Submission.Read(() => throw defect).RunExitAsync(TestContext.Current.CancellationToken);

        // Then
        Assert.True(exit is Die(var actual) && ReferenceEquals(defect, actual));
    }

    private sealed class Lease(string outcome) : ILease
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Closing { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource AllowClose { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Reads { get; private set; }
        public int Closes { get; private set; }
        public ExitCase Exit { get; private set; }
        public CancellationToken CloseToken { get; private set; }

        public async ValueTask<Result<int, ReadFailure>> Read(CancellationToken cancellationToken)
        {
            Reads++;
            Entered.TrySetResult();
            if (outcome == "cancellation")
                await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken).WaitAsync(TimeSpan.FromSeconds(5));
            if (outcome == "defect")
                throw new IOException("read failed");
            if (outcome == "error")
                return new Err<ReadFailure>(new ReadFailure("unavailable"));
            return new Ok<int>(17);
        }

        public async ValueTask Close(ExitCase exit, CancellationToken cancellationToken)
        {
            Closes++;
            Exit = exit;
            CloseToken = cancellationToken;
            Closing.TrySetResult();
            await AllowClose.Task.WaitAsync(TimeSpan.FromSeconds(5), cancellationToken);
        }
    }
}
