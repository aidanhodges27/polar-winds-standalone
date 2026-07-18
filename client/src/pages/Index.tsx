import { useEffect, useState, useRef, useCallback, useReducer } from "react";
import type { CSSProperties, Dispatch } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as Client from "colyseus.js";
import { toast } from "sonner";
import { GameScreen } from "@/screens/GameScreen";
import { saveReturnUrl, loadReturnUrl, type GameInitPayload } from "@/lib/session-storage";
import { usePlatformVoice } from "@/hooks/usePlatformVoice";
import { useSounds } from "@/hooks/use-sounds";
import { PlatformVoiceOverlay } from "@/components/game/PlatformVoiceOverlay";
import { ResultsOverlay } from "@/components/game/ResultsOverlay";
import { MilestoneShowcase } from "@/components/game/MilestoneShowcase";
import { symbolKeyFromName, milestoneAssets, type MilestoneSymbol } from "@/lib/svg3d/assets";
import type { PlayerColorId } from "@/constants/playerColors";

/** Build a redirect URL back to the platform with query params */
function buildReturnUrl(returnUrl: string, params: Record<string, string | number>): string {
  const url = new URL(returnUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

// Types
type PlayerColor = PlayerColorId;
type CollectibleType = "network" | "box" | "equilibrium" | "clone" | "vantage" | "galaxy" | "polyomino";

interface UnlockedMilestone {
  type: string;
  name: string | null;
  description: string | null;
}
type CollectibleOrientation = 0 | 90 | 180 | 270;
type CollectibleColor = PlayerColor | "NEUTRAL";

interface PlayerState {
  x: number;
  y: number;
  color: PlayerColor;
  sessionId: string;
  name: string;
  school: string;
  discordName: string;
}

interface Collectible {
  x: number;
  y: number;
  color: CollectibleColor;
  id: string;
  type: CollectibleType;
  isActivated: boolean;
  isGold: boolean;
  orientation: CollectibleOrientation;
  isFlipped: boolean;
  score: number;
}

type EnemyPersonality = "red-avoiding" | "green-avoiding" | "blue-avoiding" | "same-color-avoiding";

interface EnemyState {
  x: number;
  y: number;
  id: string;
  personality: EnemyPersonality;
}

interface ServerGameState {
  players: Map<string, PlayerState>;
  gridColors: Map<string, { color: PlayerColor }>;
  scores: Map<string, number>;
  gridWidth: number;
  gridHeight: number;
  totalScore: number;
  highScore: number;
  gameStarted: boolean;
  countdown: number;
  isGameOver: boolean;
  timeRemaining: number;
  collectibles: Map<string, Collectible>;
  enemies: Map<string, EnemyState>;
  stage: number;
  stageThresholds: number[];
  seed: number;
  linkedSessionId: string;
  linkedTeamId: "A" | "B" | "";
  linkedTeamLabel: string;
  linkedOpponentRoomId: string;
  gameDurationSeconds: number;
}

// Batched game state — updated atomically via reducer
interface GameStateLocal {
  gridWidth: number;
  gridHeight: number;
  players: Map<string, PlayerState>;
  gridColors: Map<string, PlayerColor>;
  collectibles: Collectible[];
  enemies: EnemyState[];
  scores: Record<PlayerColor, number>;
  totalScore: number;
  highScore: number;
  gameStarted: boolean;
  stage: number;
  stageThresholds: number[];
  timeRemaining: number;
  countdown: number;
  isGameOver: boolean;
  seed: number;
}

type GameAction =
  | { type: "SYNC_STATE"; payload: GameStateLocal }
  | { type: "MARK_GAME_OVER" };

// Build a score object with one key for every playable color.
const createEmptyScores = (): Record<PlayerColor, number> => ({
  RED: 0,
  GREEN: 0,
  BLUE: 0,
  YELLOW: 0,
  PURPLE: 0,
  CYAN: 0,
});

// Build the same kind of per-color object for milestone unlock lists.
const createEmptyMilestones = (): Record<PlayerColor, UnlockedMilestone[]> => ({
  RED: [],
  GREEN: [],
  BLUE: [],
  YELLOW: [],
  PURPLE: [],
  CYAN: [],
});

const initialGameState: GameStateLocal = {
  gridWidth: 10,
  gridHeight: 8,
  players: new Map(),
  gridColors: new Map(),
  collectibles: [],
  enemies: [],
  scores: createEmptyScores(),
  totalScore: 0,
  highScore: 0,
  gameStarted: false,
  stage: 1,
  stageThresholds: [],
  timeRemaining: 30 * 60,
  countdown: 0,
  isGameOver: false,
  seed: 0,
};

function gameReducer(_state: GameStateLocal, action: GameAction): GameStateLocal {
  switch (action.type) {
    case "SYNC_STATE":
      return action.payload;
    case "MARK_GAME_OVER":
      return {
        ..._state,
        isGameOver: true,
        timeRemaining: 0,
      };
    default:
      return _state;
  }
}

type Phase = "connecting" | "game";

const Index = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("connecting");

  // Init payload comes from router state (Lobby/Intro navigation)
  const routerState = location.state as { initPayload?: GameInitPayload; returnUrl?: string } | null;
  const [initPayload] = useState<GameInitPayload | null>(routerState?.initPayload ?? null);

  // Return URL for redirecting back to the platform
  // Persisted in sessionStorage so it survives page reloads
  const returnUrl = routerState?.returnUrl ?? loadReturnUrl();

  // Persist returnUrl when it comes from router state
  useEffect(() => {
    if (routerState?.returnUrl) {
      saveReturnUrl(routerState.returnUrl);
    }
  }, [routerState?.returnUrl]);


  // Connection state
  const [room, setRoom] = useState<Client.Room<ServerGameState> | null>(null);
  const [opponentRoom, setOpponentRoom] = useState<Client.Room<ServerGameState> | null>(null);
  const [myColor, setMyColor] = useState<PlayerColor | null>(null);
  const clientRef = useRef<Client.Client | null>(null);
  const roomRef = useRef<Client.Room<ServerGameState> | null>(null);
  const opponentRoomRef = useRef<Client.Room<ServerGameState> | null>(null);
  /** Resolved Colyseus room id — known after the initial join (joinOrCreate may
   * create a fresh room). Used so reconnects target the same room. */
  const connectedRoomIdRef = useRef<string | null>(routerState?.initPayload?.roomId ?? null);
  const opponentRoomIdRef = useRef<string | null>(routerState?.initPayload?.linkedSession?.spectatorRoomId ?? null);
  /** Coalesce Colyseus onStateChange bursts into one React update per frame (reduces move jank). */

  // Batched game state — single dispatch = single re-render
  const [gameState, dispatch] = useReducer(gameReducer, initialGameState);
  const [opponentGameState, opponentDispatch] = useReducer(gameReducer, initialGameState);

  // UI-only state (not server-synced)
  const [showGo, setShowGo] = useState(false);
  const prevCountdownRef = useRef(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const showResultsRef = useRef(false);
  const resultsReasonRef = useRef<"gameover" | "abandoned">("gameover");
  // Accumulates new milestones as the server broadcasts them during the game.
  // Keyed by player color → list of unlocks with card text from game_milestones.
  const [unlockedDuringGame, setUnlockedDuringGame] = useState<Record<PlayerColor, UnlockedMilestone[]>>(createEmptyMilestones);
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const bgMusicRef = useRef<HTMLAudioElement | null>(null);
  const [bgMusicVolume, setBgMusicVolume] = useState(0.3);
  const { play: playSound } = useSounds();

  // LiveKit voice chat
  const [voiceToken, setVoiceToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
  const [voiceColorMap, setVoiceColorMap] = useState<Record<string, string>>({});
  const isMultiplayer = initPayload ? !initPayload.soloMode : false;
  const isSpectator = initPayload?.spectator ?? false;
  const micEnabled = localStorage.getItem("pw-mic-skipped") !== "true";
  const voice = usePlatformVoice({
    token: voiceToken,
    livekitUrl,
    enabled: (isMultiplayer || isSpectator) && !!voiceToken,
    micEnabled,
  });

  useEffect(() => {
    showResultsRef.current = showResults;
  }, [showResults]);

  const completeGame = useCallback((reason: "gameover" | "abandoned") => {
    if (showResultsRef.current) return;
    showResultsRef.current = true;
    if (reason === "gameover") {
      dispatch({ type: "MARK_GAME_OVER" });
      opponentDispatch({ type: "MARK_GAME_OVER" });
    }
    roomRef.current?.leave();
    opponentRoomRef.current?.leave();
    resultsReasonRef.current = reason;
    setShowResults(true);
  }, []);

  // Show results overlay when game ends (stay on /play so LiveKit voice persists)
  useEffect(() => {
    const linkedOpponentEnded = Boolean(initPayload?.linkedSession && opponentGameState.isGameOver);
    if (!gameState.isGameOver && !linkedOpponentEnded) return;
    completeGame("gameover");
  }, [completeGame, gameState.isGameOver, initPayload?.linkedSession, opponentGameState.isGameOver]);

  // Open milestones modal 1s after results show, if the local player has any unlocks.
  useEffect(() => {
    if (!showResults || !myColor) return;
    const myTypes = unlockedDuringGame[myColor] ?? [];
    if (myTypes.length === 0) return;
    const t = setTimeout(() => setShowMilestoneModal(true), 1000);
    return () => clearTimeout(t);
  }, [showResults, myColor, unlockedDuringGame]);

  // Show "GO" briefly when countdown transitions from >0 to 0,
  // and play the movement SFX on each tick from 10 down through GO (0).
  useEffect(() => {
    const prev = prevCountdownRef.current;
    const current = gameState.countdown;
    prevCountdownRef.current = current;

    if (current !== prev && current >= 0 && current <= 10) {
      playSound("move");
    }

    if (prev > 0 && current === 0) {
      setShowGo(true);
      const timer = setTimeout(() => setShowGo(false), 600);
      return () => clearTimeout(timer);
    }
  }, [gameState.countdown, playSound]);

  const createStateUpdater = useCallback((
    gameRoom: Client.Room<ServerGameState>,
    targetDispatch: Dispatch<GameAction> = dispatch,
    captureMyColor = true,
  ) => () => {
    if (!gameRoom.state) return;

    const newPlayers = new Map<string, PlayerState>();
    gameRoom.state.players?.forEach((p, id) => {
      newPlayers.set(id, { x: p.x, y: p.y, color: p.color, sessionId: p.sessionId, name: p.name || "", school: p.school || "", discordName: p.discordName || "" });
      if (captureMyColor && id === gameRoom.sessionId && !myColor) setMyColor(p.color);
    });

    const newGridColors = new Map<string, PlayerColor>();
    gameRoom.state.gridColors?.forEach((c, k) => { if (c.color) newGridColors.set(k, c.color); });

    const newCollectibles: Collectible[] = [];
    gameRoom.state.collectibles?.forEach((collectible) => {
      newCollectibles.push({
        x: collectible.x,
        y: collectible.y,
        color: collectible.color,
        id: collectible.id,
        type: collectible.type,
        isActivated: collectible.isActivated,
        isGold: collectible.isGold,
        orientation: collectible.orientation as CollectibleOrientation,
        isFlipped: collectible.isFlipped,
        score: collectible.score || 0,
      });
    });

    const newEnemies: EnemyState[] = [];
    gameRoom.state.enemies?.forEach((enemy) => {
      newEnemies.push({
        x: enemy.x,
        y: enemy.y,
        id: enemy.id,
        personality: enemy.personality as EnemyPersonality,
      });
    });

    targetDispatch({
      type: "SYNC_STATE",
      payload: {
        gridWidth: gameRoom.state.gridWidth || 10,
        gridHeight: gameRoom.state.gridHeight || 8,
        totalScore: gameRoom.state.totalScore || 0,
        gameStarted: gameRoom.state.gameStarted || false,
        stage: gameRoom.state.stage || 1,
        stageThresholds: Array.from(gameRoom.state.stageThresholds || []),
        seed: gameRoom.state.seed || 0,
        players: newPlayers,
        gridColors: newGridColors,
        collectibles: newCollectibles,
        enemies: newEnemies,
        // Convert the server's Map into a plain object keyed by every playable color.
        scores: {
          RED: gameRoom.state.scores?.get("RED") || 0,
          GREEN: gameRoom.state.scores?.get("GREEN") || 0,
          BLUE: gameRoom.state.scores?.get("BLUE") || 0,
          YELLOW: gameRoom.state.scores?.get("YELLOW") || 0,
          PURPLE: gameRoom.state.scores?.get("PURPLE") || 0,
          CYAN: gameRoom.state.scores?.get("CYAN") || 0,
        },
        highScore: gameRoom.state.highScore || 0,
        countdown: gameRoom.state.countdown ?? 0,
        isGameOver: gameRoom.state.isGameOver || false,
        timeRemaining: gameRoom.state.timeRemaining ?? 30 * 60,
      },
    });
  }, [myColor]);

  const createStateUpdaterRef = useRef(createStateUpdater);
  createStateUpdaterRef.current = createStateUpdater;

  // Connect to the Colyseus room
  useEffect(() => {
    if (!initPayload || room) return;
    let aborted = false;

    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_BASE_DELAY = 1500;

    function setupRoom(
      gameRoom: Client.Room<ServerGameState>,
      options: {
        targetDispatch?: Dispatch<GameAction>;
        captureMyColor?: boolean;
        handlePlayerMessages?: boolean;
        allowReconnect?: boolean;
      } = {},
    ) {
      const {
        targetDispatch = dispatch,
        captureMyColor = true,
        handlePlayerMessages = true,
        allowReconnect = true,
      } = options;
      const runSync = () => createStateUpdaterRef.current(gameRoom, targetDispatch, captureMyColor)();
      // Sync immediately on every patch so countdown (and other fields) never sit one frame behind or coalesce wrong.
      gameRoom.onStateChange(runSync);

      gameRoom.onError((code, message) => {
        console.error(`Connection error [${code}]: ${message}`);
      });

      gameRoom.onLeave((code) => {
        console.log(`Disconnected from room (code: ${code})`);
        const state = gameRoom.state;
        const closedAtEnd =
          state?.isGameOver ||
          (!initPayload.devMode && state?.gameStarted && (state.timeRemaining ?? Infinity) <= 1);
        if (closedAtEnd) {
          targetDispatch({ type: "MARK_GAME_OVER" });
          completeGame("gameover");
          return;
        }

        if (allowReconnect && code === 1006) {
          attemptReconnect();
        } else if (allowReconnect && code !== 1000 && code !== 1001 && code !== 4000) {
          toast.error("Disconnected from the game.");
          if (returnUrl) {
            window.location.href = buildReturnUrl(returnUrl, { reason: "disconnected", disconnectReason: "unexpected" });
          }
        }
      });

      gameRoom.onMessage("boardCleared", () => {
        toast.success("Board cleared!");
      });

      gameRoom.onMessage("gameOver", () => {
        runSync();
        targetDispatch({ type: "MARK_GAME_OVER" });
        completeGame("gameover");
      });

      gameRoom.onMessage("voiceReady", (message: { token: string; livekitUrl: string; roomName: string; playerColors?: Record<string, string> }) => {
        if (!handlePlayerMessages) return;
        setVoiceToken(message.token);
        setLivekitUrl(message.livekitUrl);
        if (message.playerColors) {
          setVoiceColorMap(message.playerColors);
        }
      });

      gameRoom.onMessage(
        "milestoneUnlocked",
        (data: { color: PlayerColor; type: string; name: string | null; description: string | null }) => {
          if (!handlePlayerMessages) return;
          setUnlockedDuringGame((prev) => {
            const existing = prev[data.color] ?? [];
            if (existing.some((m) => m.type === data.type)) return prev;
            const next: UnlockedMilestone = {
              type: data.type,
              name: data.name,
              description: data.description,
            };
            return { ...prev, [data.color]: [...existing, next] };
          });
        },
      );

      return runSync;
    }

    async function attemptReconnect() {
      if (aborted) return;
      setIsReconnecting(true);
      setRoom(null);

      for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
        if (aborted) break;
        const delay = RECONNECT_BASE_DELAY * Math.pow(2, attempt - 1);
        console.log(`Reconnect attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        if (aborted) break;

        try {
          const client = new Client.Client(initPayload.serverUrl);
          clientRef.current = client;

          // Reconnect to the same room by id (the server restores the player's
          // color from userId). Without a known room id we cannot reconnect.
          const roomId = connectedRoomIdRef.current;
          if (!roomId) {
            console.error("No room id available to reconnect to");
            break;
          }
          const gameRoom = await client.joinById<ServerGameState>(roomId, {
            gameToken: initPayload.gameToken,
            userId: initPayload.userId,
            playerName: initPayload.playerName,
            spectator: initPayload.spectator,
            sessionId: initPayload.sessionId,
          });

          const updateState = setupRoom(gameRoom);
          updateState();
          roomRef.current = gameRoom;
          setRoom(gameRoom);
          setIsReconnecting(false);

          // Resume background music if it was paused during disconnect
          const audio = bgMusicRef.current;
          if (audio && audio.paused) {
            audio.play().catch(() => {
              // Autoplay blocked (mobile/strict browsers) — resume on first interaction
              const resume = () => {
                audio.play().catch(() => {});
                window.removeEventListener("pointerdown", resume);
                window.removeEventListener("keydown", resume);
              };
              window.addEventListener("pointerdown", resume, { once: true });
              window.addEventListener("keydown", resume, { once: true });
            });
          }

          console.log("Reconnected successfully!");
          return;
        } catch (e) {
          console.error(`Reconnect attempt ${attempt} failed:`, e);
        }
      }

      // All attempts failed
      setIsReconnecting(false);
      toast.error("Could not reconnect to the game.");
      if (returnUrl) {
        window.location.href = buildReturnUrl(returnUrl, { reason: "disconnected", disconnectReason: "reconnect_failed" });
      }
    }

    const connect = async () => {
      try {
        const client = new Client.Client(initPayload.serverUrl);
        clientRef.current = client;

        if (initPayload.linkedSession) {
          // A linked session has two child GameRooms. This browser joins one
          // as a player and the other as a spectator so both boards are visible
          // but only the local team's board accepts movement input.
          const linked = initPayload.linkedSession;
          const playerRoom = await client.joinById<ServerGameState>(linked.playerRoomId, {
            gameToken: initPayload.gameToken,
            userId: initPayload.userId,
            playerName: initPayload.playerName,
            sessionId: initPayload.sessionId,
          });
          const spectatorRoom = await client.joinById<ServerGameState>(linked.spectatorRoomId, {
            gameToken: initPayload.gameToken,
            userId: `${initPayload.userId}-spectator`,
            playerName: initPayload.playerName,
            spectator: true,
            sessionId: initPayload.sessionId,
          });

          connectedRoomIdRef.current = playerRoom.roomId;
          opponentRoomIdRef.current = spectatorRoom.roomId;

          const updatePlayerState = setupRoom(playerRoom);
          const updateSpectatorState = setupRoom(spectatorRoom, {
            targetDispatch: opponentDispatch,
            captureMyColor: false,
            handlePlayerMessages: false,
            allowReconnect: false,
          });
          updatePlayerState();
          updateSpectatorState();

          roomRef.current = playerRoom;
          opponentRoomRef.current = spectatorRoom;
          setRoom(playerRoom);
          setOpponentRoom(spectatorRoom);
          setPhase("game");
          return;
        }

        // Joining/spectating/reconnecting target an explicit Colyseus room id
        // (joinById). Standalone solo/multiplayer always create a fresh room; its
        // server-assigned room id is the shareable code others join by.
        const gameRoom = initPayload.roomId
          ? await client.joinById<ServerGameState>(initPayload.roomId, {
              gameToken: initPayload.gameToken,
              userId: initPayload.userId,
              playerName: initPayload.playerName,
              spectator: initPayload.spectator,
              sessionId: initPayload.sessionId,
            })
          : await client.create<ServerGameState>("game_room", {
              soloMode: initPayload.soloMode,
              userId: initPayload.userId,
              playerName: initPayload.playerName,
              devMode: initPayload.devMode,
            });

        connectedRoomIdRef.current = gameRoom.roomId;

        setupRoom(gameRoom);
        /* Hydrate from room.state immediately (reconnect path already calls this).
           Some Colyseus builds may not emit onStateChange until the next patch — without this,
           React can sit on empty initialGameState and show a blank board / wrong zoom. */
        createStateUpdaterRef.current(gameRoom)();

        roomRef.current = gameRoom;
        setRoom(gameRoom);

        // Wait for the first real state patch from Colyseus before showing
        // the game scene. This guarantees gridWidth/gridHeight are non-zero
        // so SmoothZoom initialises with a finite camera zoom.
        let initialised = false;
        gameRoom.onStateChange(() => {
          if (!initialised) {
            initialised = true;
            setPhase("game");
          }
        });
      } catch (e) {
        console.error("Failed to join game room:", e);
        toast.error("Failed to connect to game server.");
      }
    };

    connect();

    return () => {
      aborted = true;
      roomRef.current?.leave();
      opponentRoomRef.current?.leave();
    };
  }, [initPayload]); // eslint-disable-line react-hooks/exhaustive-deps

  // Transition from connecting to game when gameStarted
  useEffect(() => {
    if (gameState.gameStarted && phase === "connecting" && room) {
      setPhase("game");
    }
  }, [gameState.gameStarted, phase, room]);

  // Background music — start when game phase begins, stop on game over or unmount
  useEffect(() => {
    const url = initPayload?.bgMusicUrl;
    if (!url || phase !== "game") return;

    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.3;
    bgMusicRef.current = audio;
    audio.play().catch(() => {
      // Autoplay blocked — start on first user interaction
      const resume = () => {
        audio.play().catch(() => {});
        window.removeEventListener("pointerdown", resume);
        window.removeEventListener("keydown", resume);
      };
      window.addEventListener("pointerdown", resume, { once: true });
      window.addEventListener("keydown", resume, { once: true });
    });

    return () => {
      audio.pause();
      audio.src = "";
      bgMusicRef.current = null;
    };
  }, [phase, initPayload?.bgMusicUrl]);

  // Sync volume slider to audio element
  useEffect(() => {
    if (bgMusicRef.current) {
      bgMusicRef.current.volume = bgMusicVolume;
    }
  }, [bgMusicVolume]);

  // Fade out music on game over
  useEffect(() => {
    if (!gameState.isGameOver || !bgMusicRef.current) return;
    const audio = bgMusicRef.current;
    const fade = setInterval(() => {
      if (audio.volume > 0.05) {
        audio.volume = Math.max(0, audio.volume - 0.02);
      } else {
        clearInterval(fade);
        audio.pause();
      }
    }, 100);
    return () => clearInterval(fade);
  }, [gameState.isGameOver]);


  if (!initPayload) {
    return (
      <div className="w-full h-screen bg-canvas flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-slate-300 text-lg mb-2">Session expired</p>
          <p className="text-slate-500 text-sm mb-6">Rejoin your game from the platform.</p>
          {returnUrl ? (
            <a href={returnUrl} className="text-sky-400 hover:text-sky-300 underline text-sm">
              Back to platform
            </a>
          ) : (
            <button onClick={() => navigate("/boot", { replace: true })} className="text-sky-400 hover:text-sky-300 underline text-sm">
              Back to main menu
            </button>
          )}
        </div>
      </div>
    );
  }

  if (phase === "connecting") {
    return (
      <div className="w-full h-screen bg-canvas flex items-center justify-center">
        <div className="flex flex-col items-center gap-4" role="status" aria-live="polite" aria-label="Connecting to game…">
          <div
            className="h-10 w-10 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: "rgba(0, 149, 255, 0.3)", borderTopColor: "transparent" }}
            aria-hidden
          />
          <p className="font-montreal text-[0.6875rem] uppercase tracking-[0.06em] text-sky-200/90">
            Connecting to game…
          </p>
        </div>
      </div>
    );
  }

  const linkedSession = initPayload.linkedSession;
  // This reads Team A's high score from the correct board for either local team.
  const teamAHighScore = linkedSession?.playerTeamId === "A" ? gameState.highScore : opponentGameState.highScore;
  // This reads Team B's high score from the correct board for either local team.
  const teamBHighScore = linkedSession?.playerTeamId === "B" ? gameState.highScore : opponentGameState.highScore;
  // This starts with no winner when the game is not a team match or both high scores are equal.
  const winningTeam: "A" | "B" | null = !linkedSession || teamAHighScore === teamBHighScore
    ? null
    : teamAHighScore > teamBHighScore ? "A" : "B";
    
  const renderBoard = (
    boardRoom: Client.Room<ServerGameState> | null,
    boardState: GameStateLocal,
    boardTitle: string,
    boardSubtitle: string,
    boardIsSpectator: boolean,
  ) => (
    <GameScreen
      room={boardRoom}
      players={boardState.players}
      gridColors={boardState.gridColors}
      collectibles={boardState.collectibles}
      enemies={boardState.enemies}
      gridWidth={boardState.gridWidth}
      gridHeight={boardState.gridHeight}
      myColor={boardIsSpectator ? null : myColor}
      isSoloMode={false}
      scores={boardState.scores}
      totalScore={boardState.totalScore}
      highScore={boardState.highScore}
      stage={boardState.stage}
      stageThresholds={boardState.stageThresholds}
      timeRemaining={boardState.timeRemaining}
      isDevMode={initPayload?.devMode || false}
      isSpectator={boardIsSpectator}
      seed={boardState.seed}
      isGameOver={boardState.isGameOver}
      countdown={boardState.countdown}
      challengeName={initPayload?.challengeName}
      layout="panel"
      boardTitle={boardTitle}
      boardSubtitle={boardSubtitle}
      onGameAbandoned={
        boardIsSpectator
          ? undefined
          : () => completeGame("abandoned")
      }
    />
  );

  // TODO: alter position and move this code to GameScreen.tsx.
  // Team vs. Team ingame "TEAM MATCH CODE" display box.
  return (
    <div className="relative min-h-dvh w-full bg-canvas text-foreground">
      {linkedSession ? (
        <div className="grid h-dvh w-full grid-cols-1 gap-px bg-sky-950/40 lg:grid-cols-2">
          <div className="pointer-events-none fixed left-1/2 top-3 z-30 -translate-x-1/2 rounded-none border border-sky-300/35 bg-canvas/70 px-4 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-[6px]">
            <p className="font-montreal text-[9px] uppercase leading-tight tracking-[0.16em] text-slate-300">Team Match Code</p>
            <p className="font-montreal text-sm font-semibold uppercase leading-tight tracking-[0.18em] text-white">{linkedSession.sessionId}</p>
          </div>
          <section className="relative min-h-[50dvh] min-w-0 overflow-hidden bg-canvas lg:min-h-dvh">
            {renderBoard(
              linkedSession.playerTeamId === "A" ? room : opponentRoom,
              linkedSession.playerTeamId === "A" ? gameState : opponentGameState,
              "Team A",
              "Orange / White / Blue",
              linkedSession.playerTeamId !== "A",
            )}
          </section>
          <section className="relative min-h-[50dvh] min-w-0 overflow-hidden bg-canvas lg:min-h-dvh">
            {renderBoard(
              linkedSession.playerTeamId === "B" ? room : opponentRoom,
              linkedSession.playerTeamId === "B" ? gameState : opponentGameState,
              "Team B",
              "Yellow / Purple / Cyan",
              linkedSession.playerTeamId !== "B",
            )}
          </section>
        </div>
      ) : (
        <GameScreen
          room={room}
          players={gameState.players}
          gridColors={gameState.gridColors}
          collectibles={gameState.collectibles}
          enemies={gameState.enemies}
          gridWidth={gameState.gridWidth}
          gridHeight={gameState.gridHeight}
          myColor={myColor}
          isSoloMode={initPayload?.soloMode || false}
          scores={gameState.scores}
          totalScore={gameState.totalScore}
          highScore={gameState.highScore}
          stage={gameState.stage}
          stageThresholds={gameState.stageThresholds}
          timeRemaining={gameState.timeRemaining}
          isDevMode={initPayload?.devMode || false}
          isSpectator={isSpectator}
          seed={gameState.seed}
          isGameOver={gameState.isGameOver}
          countdown={gameState.countdown}
          bgMusicVolume={initPayload?.bgMusicUrl ? bgMusicVolume : undefined}
          onBgMusicVolumeChange={initPayload?.bgMusicUrl ? setBgMusicVolume : undefined}
          challengeName={initPayload?.challengeName}
          onGameAbandoned={() => completeGame("abandoned")}
        />
      )}
      {/* TODO: revert — temporarily showing overlay in solo mode */}
      <PlatformVoiceOverlay
        participants={voice.participants}
        isMuted={voice.isMuted}
        onToggleMute={voice.toggleMute}
        connectionState={voice.connectionState}
        room={voice.room}
        colorMap={voiceColorMap}
      />
      {(gameState.countdown > 0 || showGo) && (() => {
        const from = 10;
        const glowIntensity = showGo ? 0.5 : Math.max(0, (from - gameState.countdown) / from) * 0.35;
        const glowSize = showGo ? 70 : 30 + ((from - gameState.countdown) / from) * 30;

        const getCountStyle = (): CSSProperties => {
          if (showGo) {
            return {
              fontSize: "clamp(6rem, 20vw, 12rem)",
              color: "rgba(173, 234, 255, 1)",
              textShadow:
                "0 0 40px rgba(0, 149, 255, 0.8), 0 0 80px rgba(0, 149, 255, 0.6), 0 0 120px rgba(0, 149, 255, 0.4), 0 0 200px rgba(0, 149, 255, 0.2)",
              transform: "scale(1.2)",
              transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
            };
          }
          if (gameState.countdown <= 3) {
            return {
              fontSize: "clamp(5rem, 16vw, 10rem)",
              color: "rgba(255, 255, 255, 1)",
              textShadow:
                "0 0 30px rgba(0, 149, 255, 0.7), 0 0 60px rgba(0, 149, 255, 0.5), 0 0 100px rgba(0, 149, 255, 0.3)",
              transform: `scale(${1 + (4 - gameState.countdown) * 0.05})`,
              transition: "all 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)",
            };
          }
          if (gameState.countdown <= 6) {
            return {
              fontSize: "clamp(4rem, 12vw, 8rem)",
              color: "rgba(255, 255, 255, 0.9)",
              textShadow: "0 0 20px rgba(0, 149, 255, 0.4), 0 0 40px rgba(0, 149, 255, 0.2)",
              transform: "scale(1)",
              transition: "all 0.2s ease-out",
            };
          }
          return {
            fontSize: "clamp(3.5rem, 10vw, 7rem)",
            color: "rgba(255, 255, 255, 0.75)",
            textShadow: "0 0 10px rgba(0, 149, 255, 0.15)",
            transform: "scale(1)",
            transition: "all 0.25s ease-out",
          };
        };

        return (
          <div
            className="fixed inset-0 flex items-center justify-center z-40 pointer-events-none bg-black"
            style={{
              background: `radial-gradient(circle at 50% 50%, rgba(0, 149, 255, ${glowIntensity}) 0%, rgba(0, 60, 120, ${glowIntensity * 0.4}) ${glowSize}%, transparent ${glowSize + 30}%)`,
              transition: "background 0.3s ease",
            }}
          >
            <div
              className="font-extrabold select-none"
              style={{
                ...getCountStyle(),
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
                letterSpacing: "-0.02em",
              }}
              key={showGo ? "go" : gameState.countdown}
            >
              {showGo ? "GO" : gameState.countdown}
            </div>

            {!showGo && (
              <div
                className="absolute"
                style={{
                  width: "clamp(120px, 30vw, 240px)",
                  height: "clamp(120px, 30vw, 240px)",
                  border: `2px solid rgba(0, 149, 255, ${0.1 + ((from - gameState.countdown) / from) * 0.3})`,
                  borderRadius: "50%",
                  animation: "countdownPulse 1s ease-out infinite",
                }}
              />
            )}

            {showGo && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: "radial-gradient(circle at 50% 50%, rgba(173, 234, 255, 0.15) 0%, transparent 60%)",
                  animation: "countdownGoFlash 0.6s ease-out forwards",
                }}
              />
            )}

            <style>{`
              @keyframes countdownPulse {
                0% { transform: scale(0.9); opacity: 0.6; }
                50% { transform: scale(1.1); opacity: 0.3; }
                100% { transform: scale(1.3); opacity: 0; }
              }
              @keyframes countdownGoFlash {
                0% { opacity: 1; transform: scale(1); }
                100% { opacity: 0; transform: scale(2); }
              }
            `}</style>
          </div>
        );
      })()}
      {isReconnecting && (
        <div className="fixed inset-0 bg-canvas/85 flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
            <div
              className="h-10 w-10 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "rgba(0, 149, 255, 0.3)", borderTopColor: "transparent" }}
              aria-hidden
            />
            <div className="flex flex-col items-center gap-1">
              <p className="font-montreal text-[0.6875rem] uppercase tracking-[0.06em] text-sky-100">Server disconnected.</p>
              <p className="font-montreal text-[0.6875rem] uppercase tracking-[0.06em] text-sky-300/90">Reconnecting…</p>
            </div>
          </div>
        </div>
      )}
      {showResults && (
        <ResultsOverlay
          totalScore={gameState.totalScore}
          highScore={gameState.highScore}
          stage={gameState.stage}
          scores={gameState.scores}
          soloMode={initPayload?.soloMode || false}
          reason={resultsReasonRef.current}
          winningTeam={linkedSession ? winningTeam : undefined}
          returnUrl={returnUrl}
          players={Array.from(gameState.players.values()).map((p) => ({
            name: p.name,
            school: p.school,
            discordName: p.discordName,
            color: p.color,
          }))}
          onBack={() => {
            if (returnUrl) {
              window.location.href = returnUrl;
            } else {
              navigate("/", { replace: true });
            }
          }}
        />
      )}
      {showMilestoneModal && myColor && (() => {
        const myUnlocks = unlockedDuringGame[myColor] ?? [];
        const items = myUnlocks
          .map((m) => {
            const svgKey = symbolKeyFromName(m.type);
            if (!svgKey) return null;
            return {
              svgKey,
              name: m.name ?? milestoneAssets[svgKey].name,
              description: m.description ?? "",
            };
          })
          .filter((i): i is { svgKey: MilestoneSymbol; name: string; description: string } => i !== null);
        if (items.length === 0) return null;
        return (
          <MilestoneShowcase
            items={items}
            onDismiss={() => setShowMilestoneModal(false)}
          />
        );
      })()}
    </div>
  );
};

export default Index;
