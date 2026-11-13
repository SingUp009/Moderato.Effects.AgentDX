# Quote using an injected rate

Implement `Submission.Quote`. Use the rate source supplied by the environment for each run and pass it the caller's cancellation through the effect. Multiply the returned rate by the quantity and propagate any typed rate error. Support any environment satisfying the public constraint. Building the effect should not call the service. Preserve the public signature.
