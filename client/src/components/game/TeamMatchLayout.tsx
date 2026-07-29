import type { ReactNode } from "react";
import { ArrowLeftRight, Paintbrush, TriangleAlert } from "lucide-react";

interface TeamBoardView {
  id: "A" | "B";
  title: string;
  colors: string[];
  colorLabel: string;
  score: number;
  highScore: number;
  target: number;
  gridWidth: number;
  gridHeight: number;
  board: ReactNode;
}

interface TeamMatchLayoutProps {
  challengeName?: string;
  stage: number;
  timeRemaining: number;
  teamA: TeamBoardView;
  teamB: TeamBoardView;
  onClearBoard: () => void;
  onAbandonGame: () => void;
  onSwitchBoard: () => void;
}

const CYAN = "#00aeef";
const GOLD = "#f0a000";

function Panel({
  children,
  className = "",
  borderColor = CYAN,
}: {
  children: ReactNode;
  className?: string;
  borderColor?: string;
}) {
  return (
    <div
      className={`rounded-[10px] border bg-[#06101c]/90 ${className}`}
      style={{ borderColor }}
    >
      {children}
    </div>
  );
}

function TeamInfo({ team, onSwitch }: { team: TeamBoardView; onSwitch: () => void }) {
  return (
    <Panel className="flex min-h-[180px] flex-col px-3 pt-3">
      <p className="text-[10px] uppercase tracking-wide text-[#86a4bb]">Mode</p>
      <p className="mt-1 text-[15px] font-semibold text-white">3 vs 3</p>
      <div className="my-2 h-px bg-[#234056]" />
      <p className="text-[10px] uppercase tracking-wide text-[#86a4bb]">Color</p>
      <p className="mt-1 text-[14px] font-semibold text-white">{team.colorLabel}</p>
      <div className="mt-2 flex gap-2.5" aria-label={`${team.title} colors`}>
        {team.colors.map((color) => (
          <span
            key={color}
            className="size-7 rounded-full border border-white/40"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onSwitch}
        className="mt-auto flex h-7 items-center gap-3 border-t border-[#234056] text-left text-[12px] text-[#a7bac9] transition hover:text-white"
      >
        <kbd className="border border-[#396079] px-1 text-[10px] uppercase">Tab</kbd>
        <span>Switch Board</span>
        <ArrowLeftRight className="ml-auto size-5" strokeWidth={1.4} aria-hidden />
      </button>
    </Panel>
  );
}

function ScorePanel({ team }: { team: TeamBoardView }) {
  const percentage = Math.max(
    0,
    Math.min(100, Math.round((team.score / Math.max(team.target, 1)) * 100)),
  );
  const accent = team.id === "A" ? GOLD : CYAN;

  return (
    <Panel
      borderColor={accent}
      className="flex min-h-[360px] flex-col items-center px-4 py-3 text-center"
    >
      <p className="whitespace-nowrap text-[14px] font-bold uppercase text-[#f5f7fb]">
        {team.title} Score
      </p>
      <p className="mt-7 text-[10px] uppercase text-[#86a4bb]">Current</p>
      <p className="text-[42px] font-bold leading-none tabular-nums text-white">{team.score}</p>
      <div
        className="mt-9 grid size-[90px] place-items-center rounded-full"
        style={{
          background: `radial-gradient(circle, #07111e 58%, transparent 60%), conic-gradient(${accent} ${percentage}%, #34506a ${percentage}% 100%)`,
          boxShadow: `0 0 13px ${accent}88, inset 0 0 12px ${accent}44`,
        }}
      >
        <span className="text-[27px] font-bold text-white">{percentage}%</span>
      </div>
      <div className="mt-[-5px] h-px w-full bg-[#234056]" />
      <p className="mt-3 text-[10px] uppercase text-[#86a4bb]">High Score</p>
      <p className="text-[24px] font-semibold leading-tight text-white">{team.highScore}</p>
      <div className="my-2 h-px w-full bg-[#234056]" />
      <p className="text-[10px] uppercase text-[#86a4bb]">Target</p>
      <p className="text-[24px] font-semibold leading-tight text-white">{team.target}</p>
    </Panel>
  );
}

function Coordinates({ width, height }: { width: number; height: number }) {
  const columns = Array.from({ length: width }, (_, index) =>
    String.fromCharCode(65 + index),
  );
  const rows = Array.from({ length: height }, (_, index) => index + 1);

  return (
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden>
      <div
        className="absolute -top-6 left-0 grid w-full"
        style={{ gridTemplateColumns: `repeat(${width}, 1fr)` }}
      >
        {columns.map((column) => (
          <span key={column} className="text-center text-[12px] font-semibold text-[#dfe8ef]">
            {column}
          </span>
        ))}
      </div>
      <div
        className="absolute -left-6 top-0 grid h-full"
        style={{ gridTemplateRows: `repeat(${height}, 1fr)` }}
      >
        {rows.map((row) => (
          <span key={row} className="flex items-center text-[12px] font-semibold text-[#dfe8ef]">
            {row}
          </span>
        ))}
      </div>
    </div>
  );
}

function Board({ team }: { team: TeamBoardView }) {
  return (
    <section className="min-w-0">
      <h2 className="mb-6 text-center text-[22px] font-bold text-white">{team.title}</h2>
      <div
        className="relative aspect-[10/8] min-h-[270px] overflow-visible rounded-[5px] border"
        style={{ borderColor: CYAN }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-[4px]">{team.board}</div>
        <Coordinates width={team.gridWidth} height={team.gridHeight} />
      </div>
    </section>
  );
}

function ActionButton({
  kind,
  onClick,
}: {
  kind: "clear" | "abandon";
  onClick: () => void;
}) {
  const isClear = kind === "clear";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[47px] items-center justify-center gap-2 border bg-[#06101c]/80 px-3 text-[12px] font-bold uppercase text-[#edf3f7] transition hover:bg-[#102033] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      style={{ borderColor: isClear ? GOLD : CYAN }}
    >
      {isClear ? (
        <Paintbrush className="size-6" strokeWidth={1.5} aria-hidden />
      ) : (
        <TriangleAlert className="size-6" strokeWidth={1.5} aria-hidden />
      )}
      {isClear ? "Clear Board" : "Abandon Game"}
    </button>
  );
}

export function TeamMatchLayout({
  challengeName,
  stage,
  timeRemaining,
  teamA,
  teamB,
  onClearBoard,
  onAbandonGame,
  onSwitchBoard,
}: TeamMatchLayoutProps) {
  const minutes = Math.floor(timeRemaining / 60).toString().padStart(2, "0");
  const seconds = (timeRemaining % 60).toString().padStart(2, "0");

  return (
    <main className="team-match-ui min-h-dvh overflow-x-hidden bg-[#020812] px-3 py-5 font-montreal text-white lg:h-dvh lg:overflow-hidden">
      <div className="mx-auto grid h-full max-w-[1510px] grid-cols-1 gap-5 lg:grid-cols-[180px_1fr_1fr_180px] lg:grid-rows-[180px_1fr_74px] lg:gap-x-7 lg:gap-y-5">
        <TeamInfo team={teamA} onSwitch={onSwitchBoard} />
        <Panel className="mx-auto flex h-[112px] min-w-[180px] flex-col items-center justify-center self-start px-6 text-center lg:col-span-2 lg:col-start-2">
          {challengeName && (
            <p className="text-[10px] uppercase tracking-wide text-[#86a4bb]">{challengeName}</p>
          )}
          <p className="mt-1 text-[21px] uppercase leading-none text-[#dbe4ec]">Stage</p>
          <p className="text-[48px] font-semibold leading-none">{stage}</p>
        </Panel>
        <TeamInfo team={teamB} onSwitch={onSwitchBoard} />

        <div className="lg:row-start-2 lg:self-center"><ScorePanel team={teamA} /></div>
        <div className="grid min-w-0 gap-14 px-5 pt-6 lg:col-span-2 lg:grid-cols-2 lg:gap-16 lg:px-0 lg:pt-0">
          <Board team={teamA} />
          <Board team={teamB} />
        </div>
        <div className="lg:col-start-4 lg:row-start-2 lg:self-center"><ScorePanel team={teamB} /></div>

        <div className="flex flex-wrap gap-2 self-end">
          <ActionButton kind="clear" onClick={onClearBoard} />
          <ActionButton kind="abandon" onClick={onAbandonGame} />
        </div>
        <Panel className="mx-auto flex min-w-[188px] flex-col items-center justify-center px-5 py-2 lg:col-span-2 lg:col-start-2">
          <p className="text-[10px] uppercase tracking-wide text-[#86a4bb]">Time Remaining</p>
          <p className="text-[48px] font-bold leading-none tracking-tight tabular-nums">
            {minutes}:{seconds}
          </p>
        </Panel>
        <div className="flex flex-wrap justify-end gap-2 self-end lg:col-start-4">
          <ActionButton kind="abandon" onClick={onAbandonGame} />
          <ActionButton kind="clear" onClick={onClearBoard} />
        </div>
      </div>
    </main>
  );
}
