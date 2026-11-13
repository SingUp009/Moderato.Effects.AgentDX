using Moderato.Effects;

namespace AgentDx;

public static class Submission
{
    public static Effect<int, ReservationError, EmptyEnvironment> Reserve(int quantity, Func<int> readStock) =>
        Scope<ReservationError, EmptyEnvironment>.Gen(scope =>
        {
            if (quantity <= 0)
                throw scope.Fail(new InvalidQuantity(quantity));
            var stock = readStock();
            if (quantity > stock)
                throw scope.Fail(new InsufficientStock(stock));
            return ValueTask.FromResult(stock - quantity);
        });
}
