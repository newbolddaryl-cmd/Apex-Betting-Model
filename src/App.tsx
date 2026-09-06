/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { 
  Terminal, Sun, Moon, Search, Crosshair, Zap, RotateCcw, 
  ArrowRight, Loader2, Sparkles, Trophy, Calendar, RefreshCw,
  TrendingUp, Activity, CheckCircle2, ChevronRight
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Skin = 'dark' | 'light' | 'terminal';

interface GameEvent {
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

interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: string;
}

export default function App() {
  const [skin, setSkin] = useState<Skin>('dark');
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [liveGames, setLiveGames] = useState<GameEvent[]>([]);
  const [selectedSport, setSelectedSport] = useState<string>('ALL');
  const [isLoadingSlate, setIsLoadingSlate] = useState<boolean>(false);
  const [showSlatePanel, setShowSlatePanel] = useState<boolean>(true);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSlate();
  }, []);

  const fetchSlate = async (retryCount = 0) => {
    setIsLoadingSlate(true);
    try {
      const res = await fetch('/api/slate', { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.games && Array.isArray(data.games)) {
        setLiveGames(data.games);
      }
    } catch (err) {
      console.warn("Failed to fetch slate:", err);
      if (retryCount < 2) {
        setTimeout(() => fetchSlate(retryCount + 1), 2000);
      }
    } finally {
      setIsLoadingSlate(false);
    }
  };

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const sendQuery = async (queryText: string) => {
    const text = queryText.trim();
    if (!text || isLoading) return;

    const userMsg: Message = {
      id: String(Date.now()),
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content }))
        }),
        signal: AbortSignal.timeout(55000)
      });

      let data: any = {};
      try {
        data = await response.json();
      } catch (jsonErr) {
        throw new Error(`Server returned status ${response.status} (${response.statusText || 'Unknown Error'})`);
      }

      if (!response.ok || data.error) {
        throw new Error(data.error || `Server responded with status ${response.status}`);
      }

      const modelMsg: Message = {
        id: String(Date.now() + 1),
        role: 'model',
        content: data.result || 'No output generated.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages([...newMessages, modelMsg]);
    } catch (err: any) {
      console.error("APEX Model Request Error:", err);
      const isTimeout = err?.name === 'TimeoutError' || err?.message?.includes('timeout') || err?.message?.includes('aborted');
      const errorMsg: Message = {
        id: String(Date.now() + 1),
        role: 'model',
        content: isTimeout 
          ? `**Connection Timeout:** The sports analysis engine took longer than expected to model this slate. Click **Retry** below or submit a specific game matchup for an immediate calculation.`
          : `**Error:** Unable to complete analysis.\n\n*${err instanceof Error ? err.message : String(err)}*\n\nPlease retry in a moment.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages([...newMessages, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunModel = () => {
    sendQuery(input);
  };

  const handleClearSession = () => {
    setMessages([]);
    setInput('');
  };

  const analyzeGame = (g: GameEvent) => {
    const query = `Analyze this game with full APEX Model probability, fair implied odds, and edge calculations:\n\nMatchup: ${g.awayTeam} ${g.awayRecord ? `(${g.awayRecord})` : ''} at ${g.homeTeam} ${g.homeRecord ? `(${g.homeRecord})` : ''}\nLeague: ${g.league}\nTime & Venue: ${g.timeDetail} at ${g.venue}\nSpread / Line: ${g.spread}\nTotal: ${g.overUnder}`;
    sendQuery(query);
  };

  const lastMessage = messages[messages.length - 1];
  const showsContinuePrompt = lastMessage && lastMessage.role === 'model' && (
    lastMessage.content.trim().endsWith('Continue') ||
    lastMessage.content.includes('End with “Continue”') ||
    lastMessage.content.toLowerCase().includes('type "continue"') ||
    lastMessage.content.toLowerCase().includes('type continue')
  );

  const sportsFilters = [
    { key: 'ALL', label: 'All Sports' },
    { key: 'CFB', label: 'NCAA Football' },
    { key: 'NFL', label: 'NFL' },
    { key: 'MLB', label: 'MLB' },
    { key: 'WNBA', label: 'WNBA' },
    { key: 'NBA', label: 'NBA' },
    { key: 'SOCCER', label: 'Soccer (EPL/UCL/MLS/La Liga)' },
    { key: 'NHL', label: 'NHL' },
    { key: 'UFC', label: 'UFC / MMA' },
  ];

  const filteredGames = liveGames.filter(g => {
    if (selectedSport === 'ALL') return true;
    if (selectedSport === 'SOCCER') return ['EPL', 'UCL', 'MLS', 'LALIGA'].includes(g.sport);
    return g.sport === selectedSport;
  });

  const themes = {
    dark: {
      bg: 'bg-zinc-950',
      text: 'text-zinc-300',
      heading: 'text-zinc-100',
      card: 'bg-zinc-900',
      cardSubtle: 'bg-zinc-900/60',
      userBubble: 'bg-indigo-950/40 border-indigo-800/50 text-indigo-200',
      modelBubble: 'bg-zinc-900 border-zinc-800 text-zinc-200',
      border: 'border-zinc-800',
      accent: 'text-indigo-400',
      accentBg: 'bg-indigo-500/10',
      accentBorder: 'border-indigo-500/20',
      input: 'bg-zinc-950 border-zinc-800 text-zinc-100 focus:border-indigo-500 placeholder-zinc-600',
      button: 'bg-indigo-600 hover:bg-indigo-500 text-white',
      font: 'font-sans',
      tableHeader: 'bg-zinc-950/80 text-zinc-300',
      tableRow: 'border-zinc-800/80',
      positive: 'text-emerald-400',
      positiveBadge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      neutral: 'text-zinc-500',
      neutralBadge: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
      pillActive: 'bg-indigo-600 text-white font-semibold',
      pillInactive: 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
    },
    light: {
      bg: 'bg-slate-50',
      text: 'text-slate-700',
      heading: 'text-slate-900',
      card: 'bg-white',
      cardSubtle: 'bg-slate-100/70',
      userBubble: 'bg-indigo-50 border-indigo-200 text-indigo-900',
      modelBubble: 'bg-white border-slate-200 text-slate-800',
      border: 'border-slate-200',
      accent: 'text-indigo-600',
      accentBg: 'bg-indigo-50',
      accentBorder: 'border-indigo-200',
      input: 'bg-white border-slate-300 text-slate-900 focus:border-indigo-600 placeholder-slate-400',
      button: 'bg-indigo-600 hover:bg-indigo-700 text-white',
      font: 'font-sans',
      tableHeader: 'bg-slate-100 text-slate-800',
      tableRow: 'border-slate-200',
      positive: 'text-emerald-600',
      positiveBadge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      neutral: 'text-slate-400',
      neutralBadge: 'bg-slate-100 text-slate-600 border-slate-200',
      pillActive: 'bg-indigo-600 text-white font-semibold',
      pillInactive: 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
    },
    terminal: {
      bg: 'bg-black',
      text: 'text-emerald-500',
      heading: 'text-emerald-400',
      card: 'bg-black',
      cardSubtle: 'bg-emerald-950/20',
      userBubble: 'bg-emerald-950/40 border-emerald-800 text-emerald-300',
      modelBubble: 'bg-black border-emerald-900 text-emerald-400',
      border: 'border-emerald-900',
      accent: 'text-emerald-400',
      accentBg: 'bg-emerald-950/30',
      accentBorder: 'border-emerald-800',
      input: 'bg-black border-emerald-900 text-emerald-400 focus:border-emerald-500 placeholder-emerald-900/50',
      button: 'bg-emerald-900 hover:bg-emerald-800 text-emerald-300 border border-emerald-800',
      font: 'font-mono tracking-tight text-sm',
      tableHeader: 'bg-emerald-950/40 text-emerald-300 border-b border-emerald-900',
      tableRow: 'border-emerald-900/60',
      positive: 'text-emerald-300',
      positiveBadge: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
      neutral: 'text-emerald-800',
      neutralBadge: 'bg-black text-emerald-800 border-emerald-900',
      pillActive: 'bg-emerald-800 text-emerald-100 font-bold border border-emerald-600',
      pillInactive: 'bg-black text-emerald-600 hover:text-emerald-400 border border-emerald-900'
    }
  };

  const t = themes[skin];

  const quickPrompts = [
    { label: "Today's Full CFB Slate", query: "Analyze all NCAA College Football games scheduled for today with straight bets, parlays, and player props." },
    { label: "NFL Prime Value Plays", query: "Give me the highest-edge straight bets and multi-game parlays on the upcoming NFL slate." },
    { label: "MLB Top Edges", query: "Analyze today's MLB slate for edges on Moneyline, Run Line, and Over/Under totals." },
    { label: "Multi-Sport Parlay", query: "Build a high-confidence cross-sport parlay across tonight's best verified lines." },
    { label: "Show 70/30 Math", query: "Show the exact 70/30 Model Prob breakdown and No-Vig Fair Implied calculation for the top game." }
  ];

  const insertTemplate = (tmpl: string) => {
    setInput(prev => (prev ? prev + '\n\n' + tmpl : tmpl));
  };

  return (
    <div className={`min-h-screen ${t.bg} ${t.text} ${t.font} transition-colors duration-200 flex flex-col`}>
      {/* Header */}
      <header className={`border-b ${t.border} ${t.card} px-4 py-3 flex items-center justify-between sticky top-0 z-30`}>
        <div className="flex items-center gap-2">
          <Crosshair className={`w-5 h-5 ${t.accent}`} />
          <h1 className={`font-bold text-lg ${t.heading} tracking-wider`}>APEX.ENGINE</h1>
          <span className={`text-xs px-2.5 py-0.5 rounded-full border ${t.accentBorder} ${t.accentBg} ${t.accent} hidden sm:inline-block font-mono`}>
            ALL SPORTS & CONFERENCES DISPATCH
          </span>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setShowSlatePanel(!showSlatePanel)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${t.border} text-xs transition-all ${showSlatePanel ? t.accentBg + ' ' + t.accentBorder + ' ' + t.accent : 'opacity-70 hover:opacity-100'}`}
            title="Toggle Live Sports Slate Explorer"
          >
            <Trophy className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{showSlatePanel ? 'Hide Live Slate' : 'Browse Live Slate'}</span>
          </button>

          {messages.length > 0 && (
            <button
              onClick={handleClearSession}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${t.border} text-xs hover:opacity-100 opacity-70 transition-all`}
              title="Start Fresh Session"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New Slate</span>
            </button>
          )}

          <div className={`flex items-center gap-1 p-1 rounded-lg border ${t.border} ${t.bg}`}>
            <button 
              onClick={() => setSkin('light')} 
              className={`p-1.5 rounded-md transition-all ${skin === 'light' ? t.card + ' shadow-sm' : 'opacity-50 hover:opacity-100'}`}
              title="Clinical Light"
            >
              <Sun className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setSkin('dark')} 
              className={`p-1.5 rounded-md transition-all ${skin === 'dark' ? t.card + ' shadow-sm' : 'opacity-50 hover:opacity-100'}`}
              title="Sportsbook Dark"
            >
              <Moon className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setSkin('terminal')} 
              className={`p-1.5 rounded-md transition-all ${skin === 'terminal' ? t.card + ' shadow-sm' : 'opacity-50 hover:opacity-100'}`}
              title="Raw Data Terminal"
            >
              <Terminal className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Live Sports Slate Explorer Bar */}
      {showSlatePanel && (
        <div className={`border-b ${t.border} ${t.cardSubtle} px-4 py-2.5 z-20`}>
          <div className="max-w-7xl mx-auto flex flex-col gap-2">
            {/* Sport Filter Pills */}
            <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 scrollbar-thin">
              <div className="flex items-center gap-1.5">
                {sportsFilters.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setSelectedSport(f.key)}
                    className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap transition-all ${selectedSport === f.key ? t.pillActive : t.pillInactive}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <button
                onClick={fetchSlate}
                disabled={isLoadingSlate}
                className={`text-xs p-1.5 rounded-md border ${t.border} opacity-70 hover:opacity-100 flex items-center gap-1 shrink-0`}
                title="Refresh Live Games & Odds"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSlate ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Horizontal Game Cards Carousel */}
            <div className="flex gap-3 overflow-x-auto pb-1.5 pt-1 scrollbar-thin">
              {filteredGames.length === 0 ? (
                <div className="text-xs opacity-50 py-2">
                  {isLoadingSlate ? 'Loading verified multi-sport slate...' : 'No upcoming games found for this filter.'}
                </div>
              ) : (
                filteredGames.slice(0, 18).map(g => (
                  <div 
                    key={g.id}
                    className={`shrink-0 w-64 p-3 rounded-lg border ${t.border} ${t.card} flex flex-col justify-between hover:border-indigo-500/50 transition-all shadow-sm`}
                  >
                    <div>
                      <div className="flex items-center justify-between text-[11px] opacity-60 mb-1 font-mono">
                        <span className="font-semibold uppercase truncate">{g.league}</span>
                        <span className="truncate">{g.timeDetail.split(' at ')[1] || g.timeDetail}</span>
                      </div>

                      <div className="text-xs font-bold truncate">
                        {g.awayTeam} <span className="opacity-60 text-[10px] font-normal">{g.awayRecord}</span>
                      </div>
                      <div className="text-xs font-bold truncate">
                        @ {g.homeTeam} <span className="opacity-60 text-[10px] font-normal">{g.homeRecord}</span>
                      </div>

                      <div className="flex items-center gap-2 mt-2 text-[11px] font-mono opacity-80">
                        {g.spread !== 'N/A' && <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">{g.spread}</span>}
                        {g.overUnder !== 'N/A' && <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">{g.overUnder}</span>}
                      </div>
                    </div>

                    <button
                      onClick={() => analyzeGame(g)}
                      disabled={isLoading}
                      className={`mt-2.5 w-full py-1 text-[11px] rounded font-semibold transition-all border ${t.border} hover:${t.accentBg} hover:${t.accentBorder} hover:${t.accent} flex items-center justify-center gap-1`}
                    >
                      <Crosshair className="w-3 h-3" /> Model Game
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <main className="max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        
        {/* Left Control / Input Panel */}
        <div className="lg:col-span-4 flex flex-col space-y-4">
          <div className={`p-4 rounded-xl border ${t.border} ${t.card} flex flex-col h-[calc(100vh-12rem)] sticky top-24`}>
            <div className="mb-2">
              <h2 className={`font-semibold text-sm ${t.heading} flex items-center gap-2 tracking-wide uppercase`}>
                <Zap className="w-4 h-4" />
                Prompt & Model Dispatch
              </h2>
              <p className={`text-xs mt-0.5 ${skin === 'terminal' ? 'opacity-100' : 'opacity-70'}`}>
                Query any sport/league, player props, parlays, or custom lines.
              </p>
            </div>
            
            <textarea 
              className={`w-full flex-grow p-3 rounded-lg border ${t.input} resize-none focus:outline-none focus:ring-1 focus:ring-current text-sm`}
              placeholder="e.g. Can I get the best straight bets, parlays, and player props for today's games? Or click 'Model Game' on any card above..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleRunModel();
                }
              }}
            />

            {/* Quick Templates & Prompts */}
            <div className="mt-3 space-y-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider opacity-60 mb-1 flex items-center gap-1">
                  <Crosshair className="w-3 h-3" /> Quick Line Templates
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => insertTemplate("Game: [Team A] vs [Team B]\nSport: [CFB / NFL / MLB / NBA / Soccer]\nSpread: [Team A -X.5 (-110)]\nTotal: [O/U Y.5 (-110)]\nMoneyline: [Team A -150 / Team B +130]")}
                    className={`text-[11px] px-2 py-1 rounded border ${t.border} opacity-80 hover:opacity-100 hover:${t.accentBg}`}
                  >
                    + Game Odds
                  </button>
                  <button
                    onClick={() => insertTemplate("Player: [Player Name] | Team: [Team]\nSport: [CFB / NFL / NBA / MLB]\nProp: [Over/Under X.5 Passing/Rushing/Points/Strikeouts (-115)]")}
                    className={`text-[11px] px-2 py-1 rounded border ${t.border} opacity-80 hover:opacity-100 hover:${t.accentBg}`}
                  >
                    + Player Prop
                  </button>
                  <button
                    onClick={() => insertTemplate("Parlay Request:\nLeg 1: [Team A Spread or ML]\nLeg 2: [Team B Total or ML]\nLeg 3: [Team C Spread or Prop]\nType: [Multi-Game / SGP]")}
                    className={`text-[11px] px-2 py-1 rounded border ${t.border} opacity-80 hover:opacity-100 hover:${t.accentBg}`}
                  >
                    + Multi-Leg Parlay
                  </button>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider opacity-60 mb-1 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Quick Prompts
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {quickPrompts.map((qp, idx) => (
                    <button
                      key={idx}
                      onClick={() => sendQuery(qp.query)}
                      disabled={isLoading}
                      className={`text-xs px-2.5 py-1 rounded-md border ${t.border} hover:${t.accentBg} hover:${t.accentBorder} hover:${t.accent} transition-all disabled:opacity-40`}
                    >
                      {qp.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            
            <button 
              onClick={handleRunModel}
              disabled={isLoading || !input.trim()}
              className={`mt-3 w-full py-2.5 rounded-lg font-semibold transition-colors ${t.button} flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm`}
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {isLoading ? 'CALCULATING APEX PROBABILITIES...' : 'RUN MODEL'}
            </button>
          </div>
        </div>

        {/* Right Output / Conversation Thread Section */}
        <div className="lg:col-span-8 flex flex-col space-y-4">
          <div className={`p-5 md:p-6 rounded-xl border ${t.border} ${t.card} min-h-[calc(100vh-12rem)] flex flex-col`}>
            
            {messages.length === 0 && !isLoading && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 opacity-40">
                <Crosshair className="w-16 h-16 mb-4 animate-pulse" />
                <h3 className="text-base font-bold tracking-widest uppercase mb-1">Empirical Probability Engine</h3>
                <p className="text-xs max-w-md">
                  70% verified recent form + 30% matchup adjustment. Covering all sports, leagues, conferences, player props, and multi-game parlays.
                </p>
              </div>
            )}

            {/* Thread of Responses */}
            <div className="space-y-6 flex-1">
              {messages.map((msg) => (
                <div key={msg.id} className="space-y-2">
                  <div className="flex items-center justify-between text-xs opacity-60 px-1">
                    <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5">
                      {msg.role === 'user' ? (
                        <>USER INPUT</>
                      ) : (
                        <><Crosshair className="w-3 h-3 text-indigo-400" /> APEX MODEL OUTPUT</>
                      )}
                    </span>
                    <span className="font-mono">{msg.timestamp}</span>
                  </div>

                  <div className={`p-4 md:p-5 rounded-xl border ${msg.role === 'user' ? t.userBubble : t.modelBubble}`}>
                    {msg.role === 'user' ? (
                      <p className="text-sm font-medium whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <div className="markdown-container">
                        <Markdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h1: ({node, ...props}: any) => <h1 className={`text-xl font-bold ${t.heading} mb-3 uppercase tracking-wide border-b ${t.border} pb-2`} {...props} />,
                            h2: ({node, ...props}: any) => <h2 className={`text-lg font-bold ${t.heading} mb-3 mt-5`} {...props} />,
                            h3: ({node, ...props}: any) => <h3 className={`text-sm font-bold tracking-wider ${t.heading} border-b ${t.border} pb-1.5 mb-2.5 mt-5 uppercase`} {...props} />,
                            p: ({node, ...props}: any) => <p className="mb-3 text-sm leading-relaxed" {...props} />,
                            ul: ({node, ...props}: any) => <ul className="mb-3 space-y-1.5 text-sm list-disc list-inside" {...props} />,
                            ol: ({node, ...props}: any) => <ol className="mb-3 space-y-1.5 text-sm list-decimal list-inside" {...props} />,
                            li: ({node, ...props}: any) => <li className="leading-relaxed" {...props} />,
                            table: ({node, ...props}: any) => (
                              <div className="overflow-x-auto my-4 rounded-lg border border-zinc-800/60 shadow-inner">
                                <table className="w-full text-xs md:text-sm text-left border-collapse" {...props} />
                              </div>
                            ),
                            thead: ({node, ...props}: any) => <thead className={t.tableHeader} {...props} />,
                            th: ({node, ...props}: any) => <th className="px-3.5 py-2.5 font-semibold whitespace-nowrap border-b border-zinc-700/50" {...props} />,
                            tbody: ({node, ...props}: any) => <tbody {...props} />,
                            tr: ({node, ...props}: any) => <tr className={`border-b ${t.tableRow} hover:bg-white/[0.02]`} {...props} />,
                            td: ({node, ...props}: any) => <td className="px-3.5 py-2.5 whitespace-nowrap font-mono text-xs" {...props} />,
                            strong: ({node, ...props}: any) => <strong className={`font-semibold ${t.heading}`} {...props} />,
                            code: ({node, inline, ...props}: any) => (
                              inline 
                                ? <code className={`px-1.5 py-0.5 rounded font-mono text-xs ${t.accentBg} ${t.accent}`} {...props} />
                                : <pre className={`p-3 rounded-lg border ${t.border} bg-black/60 overflow-x-auto my-3 font-mono text-xs`}><code {...props} /></pre>
                            ),
                          }}
                        >
                          {msg.content}
                        </Markdown>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Continuation Button Prompt */}
              {showsContinuePrompt && !isLoading && (
                <div className="pt-2 flex justify-end">
                  <button
                    onClick={() => sendQuery('Continue')}
                    className={`px-4 py-2 rounded-lg font-semibold text-xs transition-all ${t.button} flex items-center gap-2 shadow-lg`}
                  >
                    <span>Continue Analysis (Next Games in Slate)</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {isLoading && (
                <div className={`p-5 rounded-xl border ${t.border} ${t.card} flex items-center gap-3 animate-pulse`}>
                  <Loader2 className={`w-5 h-5 animate-spin ${t.accent}`} />
                  <div className="text-xs font-mono">
                    Calculating 70/30 probabilities and no-vig edges across verified active slate...
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
