import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowLeftRight, Eraser, TriangleAlert } from "lucide-react";
import "./styles.css";

const columns = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
const rows = Array.from({ length: 8 }, (_, index) => index + 1);
const designWidth = 1600;
const designHeight = 900;

type PieceColor = "orange" | "white" | "blue" | "purple" | "yellow" | "green";

type Piece = {
  color: PieceColor;
  col: number;
  row: number;
  size?: "sm" | "md" | "lg";
};

const teamAPieces: Piece[] = [
  { color: "orange", col: 2, row: 2, size: "lg" },
  { color: "white", col: 6, row: 3, size: "lg" },
  { color: "blue", col: 9, row: 4, size: "lg" },
  { color: "orange", col: 3, row: 5, size: "md" },
  { color: "white", col: 7, row: 5, size: "md" },
  { color: "blue", col: 10, row: 6, size: "md" },
  { color: "orange", col: 4, row: 7, size: "md" },
  { color: "white", col: 8, row: 8, size: "md" },
];

const teamBPieces: Piece[] = [
  { color: "purple", col: 3, row: 2, size: "lg" },
  { color: "yellow", col: 6, row: 3, size: "lg" },
  { color: "green", col: 8, row: 4, size: "lg" },
  { color: "purple", col: 2, row: 5, size: "md" },
  { color: "yellow", col: 6, row: 5, size: "md" },
  { color: "green", col: 10, row: 6, size: "md" },
  { color: "purple", col: 4, row: 7, size: "md" },
  { color: "yellow", col: 8, row: 8, size: "md" },
];

const pieceColorMap: Record<PieceColor, string> = {
  orange: "#F8A51A",
  white: "#F6F7F8",
  blue: "#2B93F3",
  purple: "#9656F0",
  yellow: "#F9E344",
  green: "#45D84C",
};

function ModePanel({
  team,
  colors,
}: {
  team: "A" | "B";
  colors: PieceColor[];
}) {
  return (
    <aside className="mode-panel">
      <p className="panel-kicker">Mode</p>
      <strong className="mode-title">3 vs 3</strong>
      <div className="panel-rule" />
      <p className="panel-kicker">Color</p>
      <strong className="pieces-label">Team {team} Pieces</strong>
      <div className="swatches" aria-label={`Team ${team} colors`}>
        {colors.map((color) => (
          <span
            className="swatch"
            key={color}
            style={{ backgroundColor: pieceColorMap[color] }}
          />
        ))}
      </div>
      <div className="switch-row">
        <span className="tab-key">TAB</span>
        <span>Switch Board</span>
        <ArrowLeftRight aria-hidden="true" size={18} strokeWidth={1.8} />
      </div>
    </aside>
  );
}

function StageCard() {
  return (
    <section className="stage-card" aria-label="Current stage">
      <p>Test Challenge 10</p>
      <span>Stage</span>
      <strong>1</strong>
    </section>
  );
}

function ScorePanel({
  team,
  score,
  percent,
  accent,
}: {
  team: "A" | "B";
  score: number;
  percent: number;
  accent: string;
}) {
  return (
    <section className="score-card" style={{ "--accent": accent } as React.CSSProperties}>
      <h2>Team {team} Score</h2>
      <p className="score-label">Current</p>
      <strong className="score-current">{score}</strong>
      <div className="score-ring" style={{ "--score": `${percent}%` } as React.CSSProperties}>
        <span>{percent}%</span>
      </div>
      <div className="score-line" />
      <p className="score-label">High Score</p>
      <strong className="score-small">120</strong>
      <div className="score-line" />
      <p className="score-label">Target</p>
      <strong className="score-small">100</strong>
    </section>
  );
}

function ActionButton({
  children,
  icon,
  tone = "blue",
}: {
  children: React.ReactNode;
  icon: "clear" | "warning";
  tone?: "blue" | "gold";
}) {
  const Icon = icon === "clear" ? Eraser : TriangleAlert;

  return (
    <button className={`action-button ${tone}`} type="button">
      <Icon aria-hidden="true" size={25} strokeWidth={1.6} />
      <span>{children}</span>
    </button>
  );
}

function GameBoard({ team, pieces }: { team: "A" | "B"; pieces: Piece[] }) {
  return (
    <section className="board-wrap" aria-label={`Team ${team} board`}>
      <h2>Team {team}</h2>
      <div className="board-axis">
        <div className="axis-corner" />
        <div className="column-labels">
          {columns.map((column) => (
            <span key={column}>{column}</span>
          ))}
        </div>
        <div className="row-labels">
          {rows.map((row) => (
            <span key={row}>{row}</span>
          ))}
        </div>
        <div className="grid-board">
          {pieces.map((piece) => (
            <span
              aria-hidden="true"
              className={`piece ${piece.color} ${piece.size ?? "md"}`}
              key={`${piece.color}-${piece.col}-${piece.row}`}
              style={
                {
                  "--x": `${(piece.col - 0.5) * 10}%`,
                  "--y": `${(piece.row - 0.5) * 12.5}%`,
                  "--piece": pieceColorMap[piece.color],
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function TimerCard() {
  return (
    <section className="timer-card" aria-label="Time remaining">
      <p>Time Remaining</p>
      <strong>03:54</strong>
    </section>
  );
}

function useDesktopScale() {
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    const measure = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setScale(width <= 700 ? null : Math.min(width / designWidth, height / designHeight, 1));
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return scale;
}

function App() {
  const desktopScale = useDesktopScale();
  const shellStyle =
    desktopScale === null
      ? undefined
      : ({
          width: designWidth * desktopScale,
          height: designHeight * desktopScale,
        } as React.CSSProperties);
  const frameStyle =
    desktopScale === null
      ? undefined
      : ({ transform: `scale(${desktopScale})` } as React.CSSProperties);

  return (
    <main className="game-page min-h-screen">
      <div className="game-shell" style={shellStyle}>
        <section
          className="game-frame text-white"
          style={frameStyle}
          aria-label="Dual board game dashboard"
        >
          <div className="top-row">
            <ModePanel team="A" colors={["orange", "white", "blue"]} />
            <StageCard />
            <ModePanel team="B" colors={["purple", "yellow", "green"]} />
          </div>

          <div className="battlefield">
            <aside className="side-rail left-side">
              <ScorePanel team="A" score={80} percent={80} accent="#F4A614" />
              <div className="action-row">
                <ActionButton icon="clear" tone="gold">
                  Clear Board
                </ActionButton>
                <ActionButton icon="warning" tone="gold">
                  Abandon Game
                </ActionButton>
              </div>
            </aside>

            <div className="boards">
              <GameBoard team="A" pieces={teamAPieces} />
              <GameBoard team="B" pieces={teamBPieces} />
            </div>

            <aside className="side-rail right-side">
              <ScorePanel team="B" score={65} percent={65} accent="#2D9CF0" />
              <div className="action-row">
                <ActionButton icon="warning">Abandon Game</ActionButton>
                <ActionButton icon="clear">Clear Board</ActionButton>
              </div>
            </aside>
          </div>

          <TimerCard />
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
