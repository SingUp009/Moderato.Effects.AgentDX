# Fetch within a deadline

Implement `Submission.Fetch`. Run the supplied request with up to two immediate retries for `TransientFetchError` only. Apply a single deadline to the entire operation, including retries. On deadline, request cancellation, await the work and its cleanup, and return the `TimeoutError` case. A zero deadline must skip execution. Caller cancellation remains interruption. Use the clock provided by the run's environment. Preserve the public signature.
