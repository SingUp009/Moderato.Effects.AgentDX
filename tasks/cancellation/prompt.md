# Load a value asynchronously

Implement `Submission.Load` as a deferred effect. Call the supplied operation once per run. Pass it a token that observes caller cancellation while it is waiting. A canceled execution ends as interrupted. An unexpected exception remains a defect, including an OperationCanceledException when the caller has not canceled. Preserve the public signature.
