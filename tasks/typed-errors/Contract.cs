using Moderato.Effects;

namespace AgentDx;

public sealed record InvalidQuantity(int Quantity);
public sealed record InsufficientStock(int Available);

[Error]
public partial union ReservationError(InvalidQuantity, InsufficientStock);
