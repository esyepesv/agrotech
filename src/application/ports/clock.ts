// Tiempo inyectable: KPIs, TTL de pending y HandleIncomingMessage lo reciben
// por constructor para que los tests sean deterministas (FakeClock) sin mocks.
export interface Clock {
  now(): Date;
}
