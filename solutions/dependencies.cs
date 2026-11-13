using Moderato.Effects;

namespace AgentDx;

public static class Submission
{
    public static Effect<decimal, RateFailure, R> Quote<R>(string currency, int quantity)
        where R : IHas<IRateSource> =>
        Scope<RateFailure, R>.Gen(async scope =>
        {
            var rate = scope.Get(await scope.Env.Resolve<IRateSource>().Rate(currency, scope.CancellationToken));
            return rate * quantity;
        });
}
