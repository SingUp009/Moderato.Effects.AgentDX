using Moderato.Effects;

namespace AgentDx;

public static class Submission
{
    public static Effect<decimal, RateFailure, R> Quote<R>(string currency, int quantity)
        where R : IHas<IRateSource> =>
        throw new NotImplementedException();
}
