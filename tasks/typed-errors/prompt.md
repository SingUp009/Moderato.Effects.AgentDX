# Reserve stock

Implement `Submission.Reserve` in the starter project. Return the stock remaining after a reservation. Nonpositive quantities return `InvalidQuantity` with the input quantity before calling the stock reader. A quantity greater than the available stock returns `InsufficientStock` carrying the available stock. Read the stock once per execution and defer the read until the effect runs. Propagate an unexpected exception from the reader as a defect. Preserve the public signature and error cases.
