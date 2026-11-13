namespace AgentDx;

public sealed class TypedErrorsTests
{
    [Fact]
    public async Task Reserve_ReusedEffect_ReadsCurrentStockOncePerRun()
    {
        // Given
        var reads = 0;
        var reserve = Submission.Reserve(2, () => 6 + reads++);
        Assert.Equal(0, reads);

        // When
        var first = await reserve.RunAsync(TestContext.Current.CancellationToken);
        var second = await reserve.RunAsync(TestContext.Current.CancellationToken);

        // Then
        Assert.True(first is Ok<int>(4));
        Assert.True(second is Ok<int>(5));
        Assert.Equal(2, reads);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-3)]
    public async Task Reserve_NonpositiveQuantity_ReturnsTypedErrorBeforeReading(int quantity)
    {
        // Given
        var reads = 0;

        // When
        var exit = await Submission.Reserve(quantity, () => ++reads).RunExitAsync(TestContext.Current.CancellationToken);

        // Then
        Assert.True(exit is Err<ReservationError>(InvalidQuantity error) && error.Quantity == quantity);
        Assert.Equal(0, reads);
    }

    [Fact]
    public async Task Reserve_QuantityExceedsStock_ReturnsAvailableStock()
    {
        // Given
        const int AVAILABLE = 3;

        // When
        var exit = await Submission.Reserve(4, () => AVAILABLE).RunExitAsync(TestContext.Current.CancellationToken);

        // Then
        Assert.True(exit is Err<ReservationError>(InsufficientStock(AVAILABLE)));
    }

    [Fact]
    public async Task Reserve_ReaderThrows_PreservesDefect()
    {
        // Given
        var defect = new IOException("read failed");

        // When
        var exit = await Submission.Reserve(1, () => throw defect).RunExitAsync(TestContext.Current.CancellationToken);

        // Then
        Assert.True(exit is Die(var actual) && ReferenceEquals(defect, actual));
    }
}
