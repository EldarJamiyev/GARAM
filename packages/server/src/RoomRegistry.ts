import { GameRoom } from './GameRoom.js';

export class RoomRegistry {
  private rooms = new Map<string, GameRoom>();
  private emptyTimestamps = new Map<string, number>();
  private reapInterval: NodeJS.Timeout | null = null;
  public static readonly IDLE_REAP_MS = 60_000; // 60 seconds
  public static readonly MAX_ROOMS = 12;
  public static readonly ROOM_CODE_REGEX = /^GRM-[A-Z0-9]{3,10}$/;

  constructor() {
    // Default competitive room
    this.rooms.set('GRM-CITADEL', new GameRoom());

    // Background reaper for empty dynamic rooms
    this.reapInterval = setInterval(() => {
      this.reapIdleRooms();
    }, 10_000);
    this.reapInterval.unref(); // Prevents process hang on test exits
  }

  public getOrCreate(roomCode?: string): { room: GameRoom; code: string } {
    let code = roomCode ? roomCode.toUpperCase().trim() : 'GRM-CITADEL';

    // Validate room code format; fallback to GRM-CITADEL if invalid
    if (!RoomRegistry.ROOM_CODE_REGEX.test(code)) {
      code = 'GRM-CITADEL';
    }

    if (this.rooms.has(code)) {
      this.emptyTimestamps.delete(code);
      return { room: this.rooms.get(code)!, code };
    }

    // Capacity limit: clamp to GRM-CITADEL if server reached MAX_ROOMS
    if (this.rooms.size >= RoomRegistry.MAX_ROOMS) {
      return { room: this.rooms.get('GRM-CITADEL')!, code: 'GRM-CITADEL' };
    }

    const newRoom = new GameRoom();
    this.rooms.set(code, newRoom);
    return { room: newRoom, code };
  }

  public createUniqueRoom(): { room: GameRoom; code: string } {
    if (this.rooms.size >= RoomRegistry.MAX_ROOMS) {
      return { room: this.rooms.get('GRM-CITADEL')!, code: 'GRM-CITADEL' };
    }

    let code = '';
    do {
      const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
      code = `GRM-${rand}`;
    } while (this.rooms.has(code));

    const room = new GameRoom();
    this.rooms.set(code, room);
    return { room, code };
  }

  public get(code: string): GameRoom | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  public reapIdleRooms(now = Date.now()): string[] {
    const reaped: string[] = [];

    this.rooms.forEach((room, code) => {
      // Never reap the default lobby
      if (code === 'GRM-CITADEL') return;

      const activePlayers = room.getPlayerCount();
      if (activePlayers === 0) {
        if (!this.emptyTimestamps.has(code)) {
          this.emptyTimestamps.set(code, now);
        } else {
          const emptySince = this.emptyTimestamps.get(code)!;
          if (now - emptySince >= RoomRegistry.IDLE_REAP_MS) {
            room.stop();
            this.rooms.delete(code);
            this.emptyTimestamps.delete(code);
            reaped.push(code);
          }
        }
      } else {
        this.emptyTimestamps.delete(code);
      }
    });

    return reaped;
  }

  public getRoomCount(): number {
    return this.rooms.size;
  }

  public stopAll(): void {
    if (this.reapInterval) {
      clearInterval(this.reapInterval);
      this.reapInterval = null;
    }
    this.rooms.forEach(r => r.stop());
    this.rooms.clear();
    this.emptyTimestamps.clear();
  }
}
