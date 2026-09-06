import express from 'express';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

export interface GameEvent {
  id: string;
  sport: string;
  league: string;
  name: string;
  shortName: string;
  date: string;
  timeDetail: string;
  status: string;
  state: 'pre' | 'in' | 'post';
  venue: string;
  homeTeam: string;
  awayTeam: string;
  homeRecord: string;
  awayRecord: string;
  homeScore?: string;
  awayScore?: string;
  spread: string;
  overUnder: string;
  moneyline?: string;
  oddsDetail?: string;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for CORS and JSON
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json({ limit: '2mb' }));

  let ai: GoogleGenAI | null = null;
  function getAi() {
    if (!ai) {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY environment variable is required");
      }
      ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }
    return ai;
  }

  // Load the APEX system instructions
  const systemInstruction = fs.existsSync(path.join(process.cwd(), 'AGENTS.md')) 
    ? fs.readFileSync(path.join(process.cwd(), 'AGENTS.md'), 'utf-8') 
    : 'You are a sports betting probability engine.';

  // In-memory cache for live sports data
  let parsedGamesCache: { games: GameEvent[]; feedText: string; timestamp: number } = {
    games: [],
    feedText: '',
    timestamp: 0
  };

  let isFetchingSports = false;

  async function refreshSportsData(): Promise<{ games: GameEvent[]; feedText: string }> {
    if (isFetchingSports) {
      return parsedGamesCache;
    }
    isFetchingSports = true;

    try {
      const nowDate = new Date();
      const etFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const parts = etFormatter.formatToParts(nowDate);
      const y = parts.find(p => p.type === 'year')?.value;
      const m = parts.find(p => p.type === 'month')?.value;
      const d = parts.find(p => p.type === 'day')?.value;
      const todayStr = `${y}${m}${d}`;

      const sportConfigs = [
        { 
          sport: "CFB", 
          league: "NCAA College Football", 
          urls: [
            `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${todayStr}&limit=100`,
            `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=100`
          ] 
        },
        { 
          sport: "NFL", 
          league: "NFL", 
          urls: [`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100`] 
        },
        { 
          sport: "MLB", 
          league: "MLB Baseball", 
          urls: [`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?limit=100`] 
        },
        { 
          sport: "WNBA", 
          league: "WNBA Basketball", 
          urls: [`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?limit=100`] 
        },
        { 
          sport: "NBA", 
          league: "NBA Basketball", 
          urls: [`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?limit=100`] 
        },
        { 
          sport: "CBB", 
          league: "NCAA Men's Basketball", 
          urls: [`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?limit=100`] 
        },
        { 
          sport: "NHL", 
          league: "NHL Hockey", 
          urls: [`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?limit=100`] 
        },
        { 
          sport: "EPL", 
          league: "English Premier League", 
          urls: [`https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?limit=100`] 
        },
        { 
          sport: "UCL", 
          league: "UEFA Champions League", 
          urls: [`https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard?limit=100`] 
        },
        { 
          sport: "MLS", 
          league: "MLS Soccer", 
          urls: [`https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard?limit=100`] 
        },
        { 
          sport: "LALIGA", 
          league: "La Liga (Spain)", 
          urls: [`https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard?limit=100`] 
        },
        { 
          sport: "UFC", 
          league: "UFC / MMA", 
          urls: [`https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?limit=100`] 
        }
      ];

      const allGames: GameEvent[] = [];
      const feedBlocks: string[] = [];
      const seenIds = new Set<string>();

      // Flatten all fetch jobs with individual 2.5s timeouts
      const allFetchJobs: { cfg: typeof sportConfigs[0]; url: string }[] = [];
      for (const cfg of sportConfigs) {
        for (const u of cfg.urls) {
          allFetchJobs.push({ cfg, url: u });
        }
      }

      const results = await Promise.allSettled(
        allFetchJobs.map(async ({ cfg, url }) => {
          const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
          if (!res.ok) return { cfg, events: [] };
          const data = await res.json();
          return { cfg, events: data.events || [] };
        })
      );

      const sportFeedMap: Record<string, string[]> = {};

      for (const res of results) {
        if (res.status === 'fulfilled' && res.value?.events) {
          const { cfg, events } = res.value;
          if (!sportFeedMap[cfg.league]) {
            sportFeedMap[cfg.league] = [];
          }

          for (const e of events) {
            if (seenIds.has(e.id)) continue;
            seenIds.add(e.id);

            const comp = e.competitions?.[0] || {};
            const oddsObj = comp.odds?.[0] || {};
            const home = comp.competitors?.find((c: any) => c.homeAway === "home");
            const away = comp.competitors?.find((c: any) => c.homeAway === "away");
            const venue = comp.venue?.fullName 
              ? `${comp.venue.fullName} (${comp.venue.address?.city || ""}, ${comp.venue.address?.state || comp.venue.address?.country || ""})` 
              : "Venue N/A";
            
            const homeTeamName = home?.team?.displayName || "Home Team";
            const awayTeamName = away?.team?.displayName || "Away Team";
            const homeRec = home?.records?.[0]?.summary || "";
            const awayRec = away?.records?.[0]?.summary || "";
            const spreadStr = oddsObj.details || (oddsObj.spread ? `${oddsObj.spread}` : "N/A");
            const ouStr = oddsObj.overUnder ? `O/U ${oddsObj.overUnder}` : "N/A";
            const timeStatus = e.status?.type?.detail || e.date;
            const state = (e.status?.type?.state as 'pre' | 'in' | 'post') || "pre";

            const gameObj: GameEvent = {
              id: e.id,
              sport: cfg.sport,
              league: cfg.league,
              name: e.name || `${awayTeamName} at ${homeTeamName}`,
              shortName: e.shortName || `${away?.team?.abbreviation || "AWAY"} @ ${home?.team?.abbreviation || "HOME"}`,
              date: e.date,
              timeDetail: timeStatus,
              status: e.status?.type?.description || timeStatus,
              state: state,
              venue: venue,
              homeTeam: homeTeamName,
              awayTeam: awayTeamName,
              homeRecord: homeRec,
              awayRecord: awayRec,
              homeScore: home?.score,
              awayScore: away?.score,
              spread: spreadStr,
              overUnder: ouStr,
              oddsDetail: oddsObj.details || spreadStr
            };

            allGames.push(gameObj);

            const scoreStr = state === 'in' || state === 'post' ? ` [Score: ${awayTeamName} ${away?.score || 0} - ${homeTeamName} ${home?.score || 0}]` : '';
            sportFeedMap[cfg.league].push(`• ${awayTeamName} ${awayRec ? `[${awayRec}]` : ''} @ ${homeTeamName} ${homeRec ? `[${homeRec}]` : ''}${scoreStr} | Time: ${timeStatus} | Status: ${state} | Venue: ${venue} | Spread/Line: ${spreadStr} | Total: ${ouStr}`);
          }
        }
      }

      for (const [league, lines] of Object.entries(sportFeedMap)) {
        if (lines.length > 0) {
          feedBlocks.push(`[${league} Live Schedule & Verified Lines]\n` + lines.join("\n"));
        }
      }

      const freshResult = {
        games: allGames,
        feedText: feedBlocks.join("\n\n")
      };

      if (allGames.length > 0) {
        parsedGamesCache = { ...freshResult, timestamp: Date.now() };
      }
    } catch (err) {
      console.error("Error refreshing sports feed:", err);
    } finally {
      isFetchingSports = false;
    }

    return parsedGamesCache;
  }

  // Trigger initial background load & refresh every 45 seconds
  refreshSportsData();
  setInterval(() => {
    refreshSportsData();
  }, 45000);

  // API endpoint for frontend to get the full multi-sport live slate
  app.get('/api/slate', async (req, res) => {
    try {
      // If cache is empty, wait for quick load; otherwise return cached data immediately
      let data = parsedGamesCache;
      if (data.games.length === 0) {
        data = await refreshSportsData();
      }
      res.json({
        total: data.games.length,
        games: data.games
      });
    } catch (error: any) {
      console.error("Error fetching slate:", error);
      res.status(200).json({ total: 0, games: [] });
    }
  });

  // API endpoint for running APEX Model analysis
  app.post('/api/analyze', async (req, res) => {
    try {
      const { input, messages } = req.body;
      if (!input && (!messages || !messages.length)) {
        return res.status(400).json({ error: 'Input or messages is required' });
      }

      const genAI = getAi();
      
      const now = new Date();
      const currentDateStr = now.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        timeZone: 'America/New_York' 
      });

      // Use memory-cached feed instantly
      const liveSportsFeed = parsedGamesCache.feedText || '';

      const fullSystemInstruction = `${systemInstruction}

VERIFIED MULTI-SPORT LIVE SCHEDULE & ODDS REPOSITORY:
- Current Live Date: ${currentDateStr} (Eastern Time).
- ALL SPORTS, CONFERENCES & LEAGUES AT YOUR DISPOSAL (NCAA Football FBS/FCS, NFL, MLB, WNBA, NBA, NCAA Basketball, NHL, EPL, Champions League, MLS, La Liga, UFC/MMA):

${liveSportsFeed}

MANDATORY APEX PROBABILITY RULES ACROSS ALL SPORTS:
1. Real Multi-Sport Coverage:
   - You have full verified coverage across all conferences and leagues (SEC, Big Ten, Big 12, ACC, Pac-12, Mountain West, Sun Belt, AAC, MAC, C-USA, FCS, NFL, MLB, WNBA, NBA, Soccer, NHL, MMA).
   - If the user asks for games in any sport/league, look up the exact matchup, time, venue, and lines in the verified feed above.

2. STRICT ANTI-HALLUCINATION DIRECTIVE ON PLAYER PROPS & ROSTERS:
   - ZERO INVENTED STATS OR OBSOLETE PLAYERS: Never invent fictional player lines, and NEVER mention past-season college athletes who have graduated or gone to the NFL (e.g., DO NOT cite Luther Burden III, Cam Rising, Shedeur Sanders, Travis Hunter, Caleb Williams, Bo Nix, Dillon Gabriel, Jayden Daniels, etc., as active college players).
   - FCS/FBS blowout games or early-season games rarely have published prop lines in public feeds.
   - When the user asks for "player props" in a broad slate request and no player prop odds were provided, you MUST explicitly state under the PROPS section:
     "Player prop lines for tonight's FCS/FBS matchups are not published in the verified line feed. Paste specific player lines from your sportsbook (Player Name, Prop Over/Under line, Odds) or use the '+ Player Prop' template to calculate the 70/30 Model Prob and Edge immediately."
   - ONLY model player props when the user supplies the player, line, and odds, or when verified active prop lines are present.

3. Form & Lookback Dynamic Calibration:
   - NFL / CFB: Last 5 games form (or returning production / coaching metrics for Week 1)
   - NBA / WNBA / NHL: Last 10 games form
   - MLB: Last 20 (hitters) / Last 5 starts (pitchers)
   - Soccer / Tennis / Combat: Last 8–10 appearances

4. Calculation & Output:
   - Model Prob = (Form Hit Rate × 0.70) + (Matchup/Context Adjustment × 0.30)
   - Fair Implied% = No-Vig Baseline Implied Probability
   - Edge% = Model% − Fair Implied%
   - Unit Sizing: Edge > 5.0% (1.0u), Edge 2.5–5.0% (0.5u), Edge < 2.5% (PASS)
   - Multi-turn continuation: If the user says "continue", continue directly with the remaining games from the active slate without resetting.`;

      // Build multi-turn contents array for Gemini
      let contents: any[] = [];
      if (Array.isArray(messages) && messages.length > 0) {
        contents = messages.map(msg => ({
          role: msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user',
          parts: [{ text: msg.content || '' }]
        }));
      } else {
        contents = [{ role: 'user', parts: [{ text: input }] }];
      }

      const modelsToTry = [
        'gemini-3.7-flash',
        'gemini-3.1-flash-lite',
        'gemini-3.6-flash'
      ];
      
      let finalResult = '';
      let lastError: any = null;
      const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      for (const modelName of modelsToTry) {
        let attempts = 0;
        const maxAttempts = 2;

        while (attempts < maxAttempts) {
          try {
            attempts++;
            const response = await genAI.models.generateContent({
              model: modelName,
              contents: contents,
              config: {
                systemInstruction: fullSystemInstruction,
                temperature: 0.1,
              }
            });
            
            finalResult = response.text || '';
            if (finalResult) {
              break;
            }
          } catch (error: any) {
            lastError = error;
            const isRetryable = error?.message?.includes('503') || error?.status === 'UNAVAILABLE';
            if (isRetryable && attempts < maxAttempts) {
              await sleep(600);
            } else {
              break;
            }
          }
        }

        if (finalResult) {
          break;
        }
      }

      if (!finalResult) {
        throw lastError || new Error('Model capacity is currently saturated. Please retry in a few moments.');
      }

      res.json({ result: finalResult });
    } catch (error: any) {
      console.error("Error analyzing:", error);
      res.status(500).json({ error: error.message || 'Failed to analyze' });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
