import { describe, it, expect } from "vitest";
import { renderBusinessContext, type BusinessConfig } from "../src/businessContext";

// Fixture propio: el test NO depende de member/config.local.ts (ese archivo
// cambia por negocio y antes rompía la suite cada vez que se personalizaba).
const FIXTURE: BusinessConfig = {
  hours: "Lunes a sábado de 10 a 8",
  services: [
    { name: "Corte", price: 250 },
    { name: "Barba", price: 200 },
    { name: "Corte + Barba", price: 400 },
  ],
  location: "Av. Reforma 123, CDMX",
  paymentMethods: ["efectivo", "transferencia", "tarjeta"],
  contactPhone: "+52 55 1234 5678",
  customFields: { Estacionamiento: "sí, gratis" },
} as BusinessConfig;

describe("renderBusinessContext", () => {
  it("renders hours, services with prices, location, payment, phone", () => {
    const ctx = renderBusinessContext(FIXTURE);
    expect(ctx).toContain("Hours:");
    expect(ctx).toContain("Services and prices:");
    expect(ctx).toContain("Corte: $250");
    expect(ctx).toContain("Barba: $200");
    expect(ctx).toContain("Corte + Barba: $400");
    expect(ctx).toContain("Location:");
    expect(ctx).toContain("Payment methods:");
    expect(ctx).toContain("Phone:");
  });

  it("joins payment methods with comma", () => {
    const ctx = renderBusinessContext(FIXTURE);
    expect(ctx).toContain("efectivo, transferencia, tarjeta");
  });
});
