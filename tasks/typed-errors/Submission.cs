using Moderato.Effects;

namespace AgentDx;

public static class Submission
{
    public static Effect<int, ReservationError, EmptyEnvironment> Reserve(int quantity, Func<int> readStock) =>
        throw new NotImplementedException();
}
