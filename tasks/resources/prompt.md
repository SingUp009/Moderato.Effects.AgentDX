# Read a leased value

Implement `Submission.Read`. Open one lease for each run, read it, and close it exactly once after a successful acquisition. Pass the actual exit case to `Close`. Await cleanup before returning, including when the reader returns a typed failure, throws, or is interrupted. Pass the run cancellation token to the reader and let cleanup complete with an uncanceled token. Keep acquisition deferred until the run. Preserve the public signature.
