import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import {
  calcomConfigured,
  calcomTimeZone,
  createBooking,
  getAvailableSlots,
  resolveEventTypeId,
} from "../integrations/calcom";
import { applyResolvedDate, resolveDateInput, todayInTz } from "../time/resolveDate";

// El eventTypeId y la zona horaria se resuelven SIEMPRE en el servidor
// (CALCOM_EVENT_TYPE_ID / CALCOM_EVENT_TYPES / CALCOM_TIMEZONE): el modelo no
// conoce esos ids y no debe inventarlos.
export function scheduleAppointmentTool(env: Env, _getConversationId: () => string | null) {
  return tool({
    description:
      "Check available times and book real appointments in the business calendar (Cal.com). " +
      "To check a day, pass `date` using the customer's wording (for example, 'next Tuesday', 'Friday', or YYYY-MM-DD if they gave a day and month). " +
      "Do not convert a weekday to YYYY-MM-DD yourself; the server resolves it. " +
      "To book, pass `startTime` (ISO with offset, for example 2026-08-03T15:00:00-06:00), " +
      "`attendeeName`, and `attendeeEmail`. If the business has multiple appointment types, provide `service`.",
    inputSchema: z.object({
      date: z
        .string()
        .optional()
        .describe(
          "Date from the customer: relative text ('next Tuesday', 'Friday') or YYYY-MM-DD only if the customer gave a day and month. Do not calculate YYYY-MM-DD from a weekday.",
        ),
      startTime: z.string().optional().describe("ISO datetime with offset for booking, e.g. 2026-08-03T15:00:00-06:00"),
      attendeeName: z.string().optional(),
      attendeeEmail: z.string().email().optional(),
      service: z.string().optional().describe("Requested service or appointment type"),
      notes: z.string().optional(),
    }),
    execute: async ({ date, startTime, attendeeName, attendeeEmail, service, notes }) => {
      if (!calcomConfigured(env)) return { error: "calcom_not_configured" as const };
      const eventTypeId = resolveEventTypeId(env, service);
      if (eventTypeId == null) return { error: "calcom_not_configured" as const };
      const timeZone = calcomTimeZone(env);
      const locale = (env.BOT_LANGUAGE || "en").slice(0, 2);
      const today = todayInTz(timeZone);

      // El modelo a menudo manda un YYYY-MM-DD mal contado. Si `date` trae
      // palabras ("el próximo martes"), el resolvedor gana sobre cualquier ISO.
      let resolvedDate: string | undefined;
      let resolvedWeekday: string | undefined;
      const toResolve = date || (startTime?.slice(0, 10) ?? "");
      if (toResolve) {
        const resolved = resolveDateInput(date || toResolve, { timeZone, locale });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            today,
            hint: `Today is ${today}. Pass the date using the customer's words (for example, 'next Tuesday') or a calendar YYYY-MM-DD.`,
          };
        }
        resolvedDate = resolved.date;
        resolvedWeekday = resolved.weekday;
        if (resolvedDate < today) {
          return {
            error: "date_in_past" as const,
            today,
            weekday: resolvedWeekday,
            hint: `Today is ${today}. Recalculate the requested date from today and try again.`,
          };
        }
      }

      const bookedStart =
        startTime && resolvedDate ? applyResolvedDate(startTime, resolvedDate) : startTime;

      // Reservar: requiere hora exacta + datos del cliente.
      if (bookedStart && attendeeName && attendeeEmail) {
        const r = await createBooking(env, {
          eventTypeId,
          start: bookedStart,
          name: attendeeName,
          email: attendeeEmail,
          timeZone,
          notes,
        });
        if (!r.ok) return { error: "calcom_failed" as const, reason: r.reason };
        return {
          booked: true,
          bookingId: r.bookingId,
          status: r.status,
          start: r.start ?? bookedStart,
          date: resolvedDate,
          weekday: resolvedWeekday,
        };
      }

      // Consultar horarios libres de un día.
      if (resolvedDate) {
        const r = await getAvailableSlots(env, eventTypeId, resolvedDate, timeZone);
        if (!r.ok) return { error: "calcom_failed" as const, reason: r.reason };
        return { date: resolvedDate, weekday: resolvedWeekday, timeZone, slots: r.slots.slice(0, 12) };
      }

      return {
        error: "missing_params" as const,
        hint: "Pass `date` to check availability, or `startTime` + `attendeeName` + `attendeeEmail` to book.",
      };
    },
  });
}
