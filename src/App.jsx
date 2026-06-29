import React, { useEffect, useMemo, useRef, useState } from "react";

const avatarColors = ["#2f7d7e", "#d1603d", "#5d5f9f", "#9a6a2f", "#52733b"];
const API_BASE = import.meta.env.DEV ? "http://127.0.0.1:8787" : "";

function normalizeCode(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function calculateTimingResult({ accuracyPercent, challenge, player }) {
  const totalBonus = numberValue(player.abilityModifier) + numberValue(player.proficiencyBonus) + numberValue(player.extraBonus);
  const finalScore = Math.round(accuracyPercent / 5 + totalBonus);
  const margin = finalScore - challenge.dc;

  if (accuracyPercent >= 94 && margin >= 0) {
    return { resultTier: "Critical Success", finalScore, passed: true };
  }
  if (margin >= 0) {
    return { resultTier: "Success", finalScore, passed: true };
  }
  if (margin >= -3) {
    return { resultTier: "Partial Success", finalScore, passed: false };
  }
  return { resultTier: "Failure", finalScore, passed: false };
}

function TimingBar({ challenge, player, onSubmit, submitting }) {
  const [position, setPosition] = useState(0);
  const [stopped, setStopped] = useState(null);
  const animationRef = useRef(null);

  const totalBonus = numberValue(player.abilityModifier) + numberValue(player.proficiencyBonus) + numberValue(player.extraBonus);
  const zoneWidth = Math.max(12, Math.min(34, 20 + totalBonus * 1.4 - (challenge.dc - 15) * 0.7));
  const markerSpeed = Math.max(0.55, 1.25 - totalBonus * 0.035 + (challenge.dc - 15) * 0.025);
  const zoneStart = 50 - zoneWidth / 2;
  const zoneCenter = 50;

  useEffect(() => {
    if (stopped) return undefined;
    const start = performance.now();

    function animate(now) {
      const elapsed = ((now - start) / 1000) * markerSpeed;
      const wave = (Math.sin(elapsed * Math.PI * 2) + 1) / 2;
      setPosition(wave * 100);
      animationRef.current = requestAnimationFrame(animate);
    }

    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [markerSpeed, stopped]);

  function stopMarker() {
    const distanceFromCenter = Math.abs(position - zoneCenter);
    const zoneRadius = zoneWidth / 2;
    const isInsideZone = position >= zoneStart && position <= zoneStart + zoneWidth;
    const accuracyPercent = isInsideZone ? Math.max(0, Math.round(100 - (distanceFromCenter / zoneRadius) * 45)) : Math.max(0, Math.round(55 - distanceFromCenter));
    const result = calculateTimingResult({ accuracyPercent, challenge, player });
    setStopped({ accuracyPercent, ...result });
  }

  async function submitResult() {
    if (!stopped) return;
    await onSubmit({
      challengeId: challenge.id,
      playerId: player.id,
      accuracyPercent: stopped.accuracyPercent,
      finalScore: stopped.finalScore,
      resultTier: stopped.resultTier,
      passed: stopped.passed
    });
  }

  return (
    <div className="timing-game">
      <div>
        <p className="eyebrow">Timing Bar</p>
        <h3>{challenge.skill}</h3>
        <p className="muted-line">
          DC {challenge.dc} with +{totalBonus} total character bonus
        </p>
      </div>

      <div className="timing-track" aria-label="Timing challenge bar">
        <span className="success-zone" style={{ left: `${zoneStart}%`, width: `${zoneWidth}%` }} />
        <span className="center-line" />
        <span className="timing-marker" style={{ left: `${position}%` }} />
      </div>

      {stopped ? (
        <div className="result-preview">
          <strong>{stopped.resultTier}</strong>
          <span>
            Accuracy {stopped.accuracyPercent}% - Score {stopped.finalScore} vs DC {challenge.dc}
          </span>
        </div>
      ) : null}

      <button className="primary-button" type="button" onClick={stopped ? submitResult : stopMarker} disabled={submitting}>
        {stopped ? (submitting ? "Submitting..." : "Submit Result") : "Stop Marker"}
      </button>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState("home");
  const [playerName, setPlayerName] = useState("Taylor");
  const [joinCode, setJoinCode] = useState("");
  const [stats, setStats] = useState({ abilityModifier: 3, proficiencyBonus: 2, extraBonus: 0 });
  const [lobby, setLobby] = useState(null);
  const [currentPlayerId, setCurrentPlayerId] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [challengeForm, setChallengeForm] = useState({ skill: "Stealth", dc: 15 });
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const cleanJoinCode = normalizeCode(joinCode);
  const players = lobby?.players || [];
  const playerCharacters = players.filter((player) => player.role === "Player");
  const currentPlayer = players.find((player) => player.id === currentPlayerId);
  const selectedPlayer = playerCharacters.find((player) => player.id === selectedPlayerId);
  const activeChallenge = lobby?.challenges?.find(
    (challenge) => challenge.playerId === currentPlayerId && challenge.status === "pending"
  );

  const shareText = useMemo(() => {
    if (!lobby?.code) return "Create a DM room to get a join code.";
    return `Players can join this room with code ${lobby.code}`;
  }, [lobby?.code]);

  useEffect(() => {
    if (!lobby?.code) return undefined;

    const events = new EventSource(`${API_BASE}/api/lobbies/${lobby.code}/events`);
    events.addEventListener("lobby", (event) => {
      const data = JSON.parse(event.data);
      setLobby(data.lobby);
    });
    events.onerror = () => setError("Live room connection paused. Refresh if updates stop.");

    return () => events.close();
  }, [lobby?.code]);

  useEffect(() => {
    if (!selectedPlayerId && playerCharacters.length) {
      setSelectedPlayerId(playerCharacters[0].id);
    }
  }, [playerCharacters, selectedPlayerId]);

  async function handleCopyCode() {
    if (!lobby?.code) return;
    await navigator.clipboard?.writeText(lobby.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function handleCreateRoom() {
    setBusy(true);
    setError("");
    try {
      const data = await apiRequest("/api/lobbies", {
        method: "POST",
        body: JSON.stringify({ name: playerName, ...stats })
      });
      setLobby(data.lobby);
      setCurrentPlayerId(data.playerId);
      setJoinCode(data.lobby.code);
      setView("dm");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinRoom() {
    if (cleanJoinCode.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      const data = await apiRequest(`/api/lobbies/${cleanJoinCode}/join`, {
        method: "POST",
        body: JSON.stringify({ name: playerName, ...stats })
      });
      setLobby(data.lobby);
      setCurrentPlayerId(data.playerId);
      setJoinCode(data.lobby.code);
      setView("player");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSendChallenge() {
    if (!lobby?.code || !selectedPlayerId) return;
    setBusy(true);
    setError("");
    try {
      const data = await apiRequest(`/api/lobbies/${lobby.code}/challenges`, {
        method: "POST",
        body: JSON.stringify({
          playerId: selectedPlayerId,
          skill: challengeForm.skill,
          dc: challengeForm.dc
        })
      });
      setLobby(data.lobby);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitResult(result) {
    if (!lobby?.code) return;
    setBusy(true);
    setError("");
    try {
      const data = await apiRequest(`/api/lobbies/${lobby.code}/results`, {
        method: "POST",
        body: JSON.stringify(result)
      });
      setLobby(data.lobby);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  function updateStat(key, value) {
    setStats((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className="app-shell">
      <section className="lobby-panel app-panel" aria-label="RPG companion prototype">
        <div className="control-column">
          <div className="load-banner" role="status">
            Prototype live
          </div>

          <div className="brand-row">
            <span className="brand-mark">SA</span>
            <div>
              <p className="eyebrow">Tabletop Companion</p>
              <h1>{view === "dm" ? "DM Room" : view === "player" ? "Player Room" : "Skill Checks"}</h1>
            </div>
          </div>

          {view === "home" ? (
            <div className="home-actions">
              <button className="primary-button" type="button" onClick={() => setView("create")}>
                Create DM Room
              </button>
              <button className="secondary-button" type="button" onClick={() => setView("join")}>
                Join Player Room
              </button>
            </div>
          ) : null}

          {view === "create" || view === "join" ? (
            <div className="action-stack">
              <label className="field-label" htmlFor="player-name">
                {view === "create" ? "DM name" : "Player name"}
              </label>
              <input
                id="player-name"
                className="text-input"
                value={playerName}
                maxLength={18}
                onChange={(event) => setPlayerName(event.target.value)}
                placeholder="Enter a display name"
              />

              {view === "join" ? (
                <>
                  <label className="field-label" htmlFor="join-code">
                    Room code
                  </label>
                  <input
                    id="join-code"
                    className="text-input code-input"
                    value={cleanJoinCode}
                    onChange={(event) => setJoinCode(event.target.value)}
                    placeholder="ABC123"
                    inputMode="text"
                    maxLength={6}
                  />
                </>
              ) : null}

              {view === "join" ? (
                <div className="stat-grid">
                  <label>
                    Ability mod
                    <input type="number" value={stats.abilityModifier} onChange={(event) => updateStat("abilityModifier", event.target.value)} />
                  </label>
                  <label>
                    Proficiency
                    <input type="number" value={stats.proficiencyBonus} onChange={(event) => updateStat("proficiencyBonus", event.target.value)} />
                  </label>
                  <label>
                    Extra
                    <input type="number" value={stats.extraBonus} onChange={(event) => updateStat("extraBonus", event.target.value)} />
                  </label>
                </div>
              ) : null}

              <button
                className="primary-button"
                type="button"
                disabled={busy || playerName.trim().length < 2 || (view === "join" && cleanJoinCode.length !== 6)}
                onClick={view === "create" ? handleCreateRoom : handleJoinRoom}
              >
                {busy ? "Connecting..." : view === "create" ? "Create Room" : "Join Room"}
              </button>
              <button className="text-button" type="button" onClick={() => setView("home")}>
                Back
              </button>
            </div>
          ) : null}

          {view === "dm" && lobby ? (
            <div className="action-stack">
              <div className="code-card">
                <span>Room code</span>
                <strong>{lobby.code}</strong>
                <div className="code-actions">
                  <button onClick={handleCopyCode} type="button" title="Copy code">
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button type="button" disabled>
                    DM View
                  </button>
                </div>
              </div>
              <p className="share-line">{shareText}</p>
            </div>
          ) : null}

          {view === "player" && lobby ? (
            <div className="player-status">
              <p className="eyebrow">Joined Room</p>
              <strong>{lobby.code}</strong>
              <span>{currentPlayer?.name} is waiting for a challenge.</span>
            </div>
          ) : null}

          {error ? <p className="error-line">{error}</p> : null}
        </div>

        <div className="status-column">
          {view === "dm" && lobby ? (
            <>
              <div className="lobby-header">
                <div>
                  <p className="eyebrow">Control Panel</p>
                  <h2>{lobby.code}</h2>
                </div>
                <span className="status-pill online">{playerCharacters.length} players</span>
              </div>

              <div className="dm-grid">
                <section className="tool-section">
                  <div className="section-heading">
                    <p className="eyebrow">Players</p>
                    <strong>Connected</strong>
                  </div>
                  <div className="player-list">
                    {playerCharacters.length ? (
                      playerCharacters.map((player, index) => (
                        <button
                          className={selectedPlayerId === player.id ? "player-row selected" : "player-row"}
                          key={player.id}
                          type="button"
                          onClick={() => setSelectedPlayerId(player.id)}
                        >
                          <div className="avatar" style={{ background: avatarColors[index % avatarColors.length] }}>
                            {player.name.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="player-copy">
                            <strong>{player.name}</strong>
                            <span>
                              +{numberValue(player.abilityModifier) + numberValue(player.proficiencyBonus) + numberValue(player.extraBonus)} total bonus
                            </span>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="empty-state">Waiting for players</div>
                    )}
                  </div>
                </section>

                <section className="tool-section">
                  <div className="section-heading">
                    <p className="eyebrow">Challenge</p>
                    <strong>Timing Bar</strong>
                  </div>
                  <label className="field-label" htmlFor="target-player">
                    Send to
                  </label>
                  <select
                    id="target-player"
                    className="text-input"
                    value={selectedPlayerId}
                    onChange={(event) => setSelectedPlayerId(event.target.value)}
                    disabled={!playerCharacters.length}
                  >
                    {playerCharacters.length ? (
                      playerCharacters.map((player) => (
                        <option key={player.id} value={player.id}>
                          {player.name} (+{numberValue(player.abilityModifier) + numberValue(player.proficiencyBonus) + numberValue(player.extraBonus)})
                        </option>
                      ))
                    ) : (
                      <option value="">No players connected</option>
                    )}
                  </select>
                  <label className="field-label" htmlFor="skill-name">
                    Check name
                  </label>
                  <input
                    id="skill-name"
                    className="text-input"
                    value={challengeForm.skill}
                    onChange={(event) => setChallengeForm((current) => ({ ...current, skill: event.target.value }))}
                  />
                  <label className="field-label" htmlFor="dc-value">
                    DC
                  </label>
                  <input
                    id="dc-value"
                    className="text-input"
                    type="number"
                    min="5"
                    max="30"
                    value={challengeForm.dc}
                    onChange={(event) => setChallengeForm((current) => ({ ...current, dc: event.target.value }))}
                  />
                  {selectedPlayer ? (
                    <p className="target-summary">
                      Targeting <strong>{selectedPlayer.name}</strong> with a +
                      {numberValue(selectedPlayer.abilityModifier) +
                        numberValue(selectedPlayer.proficiencyBonus) +
                        numberValue(selectedPlayer.extraBonus)}{" "}
                      total bonus.
                    </p>
                  ) : null}
                  <button className="primary-button" type="button" disabled={!selectedPlayerId || busy} onClick={handleSendChallenge}>
                    {busy ? "Sending..." : `Send to ${selectedPlayer?.name || "Player"}`}
                  </button>
                </section>
              </div>

              <section className="tool-section results-section">
                <div className="section-heading">
                  <p className="eyebrow">Results</p>
                  <strong>Returned to DM</strong>
                </div>
                <div className="results-list">
                  {lobby.results.length ? (
                    lobby.results.slice(0, 15).map((result) => {
                      const player = players.find((candidate) => candidate.id === result.playerId);
                      return (
                        <article className="result-row" key={result.id}>
                          <strong>
                            {player?.name || "Player"} - {result.checkName}
                          </strong>
                          <span>
                            {result.resultTier}: {result.finalScore} vs DC {result.dc} ({result.accuracyPercent}%)
                          </span>
                        </article>
                      );
                    })
                  ) : (
                    <div className="empty-state">No challenge results yet</div>
                  )}
                </div>
              </section>
            </>
          ) : null}

          {view === "player" && lobby ? (
            <>
              <div className="lobby-header">
                <div>
                  <p className="eyebrow">Player Screen</p>
                  <h2>{currentPlayer?.name || "Player"}</h2>
                </div>
                <span className="status-pill online">Room {lobby.code}</span>
              </div>

              {activeChallenge ? (
                <TimingBar challenge={activeChallenge} player={currentPlayer} onSubmit={handleSubmitResult} submitting={busy} />
              ) : (
                <div className="waiting-panel">
                  <p className="eyebrow">Standing By</p>
                  <h3>No active challenge</h3>
                  <p className="muted-line">When the DM sends a check, the timing bar will appear here.</p>
                </div>
              )}
            </>
          ) : null}

          {view === "home" || view === "create" || view === "join" ? (
            <div className="intro-panel">
              <p className="eyebrow">MVP Flow</p>
              <h2>Send skill checks to phones.</h2>
              <p>
                The DM creates a room, players join with stats, and the first prototype challenge is a hybrid timing-bar check.
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
