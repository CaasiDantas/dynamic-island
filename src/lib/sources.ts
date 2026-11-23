/**
 * Pontos de entrada das integrações.
 *
 * Mídia: sessão real do Windows (SMTC), ver features/media.
 * Notificações: ainda sem fonte; a interface mostra o estado vazio honesto
 * em vez de dados inventados.
 */

export { useMedia as useMediaSession, type MediaInfo as MediaSession } from "../features/media/store";

export interface IslandNotification {
  id: string;
  app: string;
  title: string;
  body: string;
  receivedAt: Date;
}

export function useNotifications(): IslandNotification[] {
  return [];
}
