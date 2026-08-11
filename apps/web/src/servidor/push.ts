import { createHash } from 'node:crypto';
import { formatMoney } from '@gastos/core';
import { base, esquema } from '@gastos/db';
import { and, eq } from 'drizzle-orm';
import webpush from 'web-push';

export interface PushSuscripcionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function claveVapidPublica(): string | null {
  const clave = process.env.VAPID_PUBLIC_KEY?.trim();
  return clave || null;
}

function vapidListo(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim());
}

function idDeEndpoint(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('base64url').slice(0, 16);
}

export async function guardarSuscripcionPush(
  usuarioId: string,
  sub: PushSuscripcionJSON,
): Promise<boolean> {
  const endpoint = sub.endpoint?.trim();
  const p256dh = sub.keys?.p256dh?.trim();
  const auth = sub.keys?.auth?.trim();
  if (!endpoint || !p256dh || !auth) return false;

  const db = await base();
  const id = idDeEndpoint(endpoint);

  await db
    .insert(esquema.pushSuscripciones)
    .values({ id, usuarioId, endpoint, p256dh, auth })
    .onConflictDoUpdate({
      target: [esquema.pushSuscripciones.usuarioId, esquema.pushSuscripciones.id],
      set: { endpoint, p256dh, auth },
    });

  return true;
}

export async function enviarPushNuevoAviso(
  usuarioId: string,
  aviso: {
    emisorNombre: string;
    tituloGasto: string;
    montoCentavos: number;
    pendientes: number;
  },
): Promise<void> {
  if (!vapidListo()) return;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || 'mailto:avisos@gastos.app',
    process.env.VAPID_PUBLIC_KEY!.trim(),
    process.env.VAPID_PRIVATE_KEY!.trim(),
  );

  const db = await base();
  const subs = await db
    .select()
    .from(esquema.pushSuscripciones)
    .where(eq(esquema.pushSuscripciones.usuarioId, usuarioId));

  if (subs.length === 0) return;

  const quien = aviso.emisorNombre.trim() || 'Alguien';
  const monto = formatMoney(aviso.montoCentavos, { currency: 'COP' });
  const payload = JSON.stringify({
    title: `${quien} te compartió un gasto`,
    body: `${aviso.tituloGasto} · ${monto}`,
    url: '/gastos.html#notificaciones',
    badge: Math.min(aviso.pendientes, 99),
  });

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
      } catch (error: unknown) {
        const status = (error as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          await db
            .delete(esquema.pushSuscripciones)
            .where(
              and(
                eq(esquema.pushSuscripciones.usuarioId, usuarioId),
                eq(esquema.pushSuscripciones.id, sub.id),
              ),
            );
        }
      }
    }),
  );
}
