import { createContext, useCallback, useContext, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  categorySummaries as sampleTiles,
  lookDefaults,
  occasions,
  photos,
  shoppingAdvice as sampleAdvice,
  shoppingDefaultPrompt,
  styles,
  wardrobeCategories,
} from "./data/mock";
import { api, ApiError, getSession, shrinkPhoto, type Look, type Me, type Scan } from "./lib/api";
import { useApi } from "./lib/useApi";
import SignIn from "./SignIn";
import { Rack, RACK_ORDER, useBackgroundCleanup } from "./Closet";
import { makeCutout, warmUpCutouts } from "./lib/cutout";
import ModelView from "./ModelView";
import BodyProfileSheet from "./BodyProfileSheet";
import type { LookRequest, Screen, UserStats, Weather } from "./types";

// Signed-in user's profile, stats and local weather, shared by the top bar and every screen
type AppData = {
  me?: Me;
  stats?: UserStats;
  weather?: Weather & { location: string };
  setMe: (me: Me) => void;
  refreshStats: () => void;
  refreshWeather: () => void;
};
const AppDataContext = createContext<AppData>({ setMe: () => {}, refreshStats: () => {}, refreshWeather: () => {} });
const useAppData = () => useContext(AppDataContext);

const tempText = (tempC?: number | null) => (tempC == null ? "–°" : `${tempC}°`);
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function ErrorNote({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return <div role="alert" className={`rounded-2xl px-4 py-3 text-xs ${light ? "bg-white/10 text-white/75" : "bg-[#fbe9e4] text-[#9a3a22]"}`}>{children}</div>;
}

type IconName =
  | "home"
  | "sparkles"
  | "hanger"
  | "heart"
  | "user"
  | "arrow"
  | "plus"
  | "cloud"
  | "pin"
  | "calendar"
  | "clock"
  | "check"
  | "refresh"
  | "swap"
  | "bookmark"
  | "bag"
  | "camera"
  | "search"
  | "settings"
  | "chevron"
  | "wand";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5M9 21v-7h6v7"/></>,
    sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z"/><path d="m5 15 .7 2.3L8 18l-2.3.7L5 21l-.7-2.3L2 18l2.3-.7L5 15ZM19 13l.6 1.7 1.7.6-1.7.6L19 18l-.6-2.1-1.7-.6 1.7-.6L19 13Z"/></>,
    hanger: <><path d="M9 6.5A3 3 0 1 1 12 10v2"/><path d="m12 12-9 6h18l-9-6Z"/></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    cloud: <path d="M17.5 19H6a4 4 0 0 1-.4-8A6.5 6.5 0 0 1 18 9a5 5 0 0 1-.5 10Z"/>,
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    refresh: <><path d="M20 7v5h-5"/><path d="M18.5 16a8 8 0 1 1 .8-9L20 12"/></>,
    swap: <><path d="m7 7-4 4 4 4M3 11h14"/><path d="m17 3 4 4-4 4M21 7H7"/></>,
    bookmark: <path d="M6 3h12v18l-6-4-6 4V3Z"/>,
    bag: <><path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></>,
    camera: <><path d="M4 7h4l1.5-2h5L16 7h4v12H4V7Z"/><circle cx="12" cy="13" r="4"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a2 2 0 0 0 .4 2.2l.1.1-2.6 2.6-.1-.1a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.2 1.8V21h-3.6v-.2A2 2 0 0 0 9 19a2 2 0 0 0-2.2.4l-.1.1-2.6-2.6.1-.1A2 2 0 0 0 4.6 15a2 2 0 0 0-1.8-1.2H3v-3.6h.2A2 2 0 0 0 5 9a2 2 0 0 0-.4-2.2l-.1-.1 2.6-2.6.1.1A2 2 0 0 0 9 4.6a2 2 0 0 0 1.2-1.8V3h3.6v.2A2 2 0 0 0 15 5a2 2 0 0 0 2.2-.4l.1-.1 2.6 2.6-.1.1A2 2 0 0 0 19.4 9a2 2 0 0 0 1.8 1.2h.2v3.6h-.2A2 2 0 0 0 19.4 15Z"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    wand: <><path d="m15 4 5 5L8 21l-5-5L15 4Z"/><path d="m12 7 5 5M6 3v3M4.5 4.5h3M20 16v4M18 18h4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}

function Button({
  children,
  onClick,
  variant = "primary",
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "cream";
  className?: string;
  type?: "button" | "submit";
}) {
  const variants = {
    primary: "bg-[#20251f] text-white hover:bg-[#333b32]",
    secondary: "bg-white text-[#20251f] border border-[#d9ddd5] hover:bg-[#f5f3ed]",
    ghost: "bg-transparent text-[#20251f] hover:bg-black/5",
    cream: "bg-[#f2eee4] text-[#20251f] hover:bg-white",
  };
  return <button type={type} onClick={onClick} className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-3.5 text-sm font-semibold transition-all duration-300 active:scale-[.98] ${variants[variant]} ${className}`}>{children}</button>;
}

// the logo: the hanger mark in a lime circle, then the wordmark (public/brand)
const brand = (file: string) => `${import.meta.env.BASE_URL}brand/${file}`;

function Brand() {
  return <button className="group flex items-center gap-2.5" onClick={() => window.scrollTo(0, 0)} aria-label="Wardrobe AI, back to top">
    <span className="grid h-9 w-9 place-items-center rounded-full bg-[#d8ff60] transition-transform group-hover:rotate-12"><img src={brand("mark.png")} alt="" className="w-[22px]"/></span>
    <img src={brand("wordmark.png")} alt="Wardrobe AI" className="h-[22px] w-auto"/>
  </button>;
}

function Avatar({ className }: { className: string }) {
  const { me } = useAppData();
  if (me?.avatarUrl) return <img className={className} src={me.avatarUrl} alt={me.name ? `${me.name.split(" ")[0]}'s profile` : "Profile"} />;
  return <span className={`grid place-items-center bg-[#d8ff60] font-serif text-[#20251f] ${className}`} aria-label="Profile">{(me?.name || me?.email || "?").charAt(0).toUpperCase()}</span>;
}

function TopBar({ onProfile }: { onProfile: () => void }) {
  const { me, weather } = useAppData();
  return <header className="sticky top-0 z-40 border-b border-black/5 bg-[#f8f7f2]/90 backdrop-blur-xl">
    <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-4 lg:px-10">
      <Brand />
      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-full border border-black/8 bg-white px-4 py-2 text-xs text-[#5c625b] sm:flex"><Icon name="cloud" size={16}/>{` ${tempText(weather?.tempC)} · ${me?.city || "Set your city"}`}</div>
        <button onClick={onProfile} aria-label="Open profile" className="h-10 w-10 overflow-hidden rounded-full ring-2 ring-white shadow-md">
          <Avatar className="h-full w-full object-cover text-lg" />
        </button>
      </div>
    </div>
  </header>;
}

const navItems: { id: Screen; label: string; icon: IconName }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "generator", label: "Style AI", icon: "sparkles" },
  { id: "wardrobe", label: "Wardrobe", icon: "hanger" },
  { id: "recommendations", label: "For You", icon: "heart" },
  { id: "profile", label: "Profile", icon: "user" },
];

function BottomNav({ screen, go }: { screen: Screen; go: (s: Screen) => void }) {
  return <nav className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-24px)] max-w-xl -translate-x-1/2 rounded-[28px] border border-white/60 bg-[#20251f]/95 p-2 shadow-2xl shadow-black/20 backdrop-blur-xl">
    <div className="grid grid-cols-5 gap-1">
      {navItems.map((item) => {
        const active = screen === item.id || (item.id === "generator" && ["loading", "look"].includes(screen));
        const featured = item.id === "generator";
        return <button key={item.id} onClick={() => go(item.id)} aria-current={active ? "page" : undefined} className={`relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-[20px] text-[10px] font-medium transition-all ${active ? "bg-white text-[#20251f]" : "text-white/60 hover:text-white"} ${featured && !active ? "text-[#d8ff60]" : ""}`}>
          {featured && !active && <span className="absolute -top-5 grid h-9 w-9 place-items-center rounded-full bg-[#d8ff60] text-[#20251f] shadow-lg"><Icon name={item.icon} size={18}/></span>}
          <span className={featured && !active ? "mt-4" : ""}>{(!featured || active) && <Icon name={item.icon} size={19}/>}</span>
          <span>{item.label}</span>
        </button>;
      })}
    </div>
  </nav>;
}

function Eyebrow({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return <div className={`mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] ${light ? "text-white/65" : "text-[#737a70]"}`}><span className="h-1.5 w-1.5 rounded-full bg-[#d8ff60]"/>{children}</div>;
}

function SectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return <div className="mb-6 flex items-end justify-between gap-4">
    <div>{eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}<div className="font-serif text-3xl leading-none tracking-tight sm:text-4xl">{title}</div></div>
    {action}
  </div>;
}

function Home({ go, openLook }: { go: (s: Screen) => void; openLook: (id: string) => void }) {
  const { me, stats, weather } = useAppData();
  const count = stats?.wardrobeCount ?? 0;
  const todaysPick = useApi(api.today).data;
  const summary = useApi(api.summary);
  const trends = useApi(api.trends, [me?.city]);
  // decorative photos stand in until a category has items of its own
  const tiles = (summary.data ?? sampleTiles.map((t) => ({ ...t, count: 0, imageUrl: "" }))).map((t, i) => ({ ...t, imageUrl: t.imageUrl || sampleTiles[i % sampleTiles.length].imageUrl }));
  return <main>
    <section className="mx-auto max-w-[1440px] px-4 pt-4 sm:px-6 lg:px-10 lg:pt-7">
      <div className="hero-grid relative min-h-[680px] overflow-hidden rounded-[32px] bg-[#222820] text-white">
        <img src={photos.hero} alt="Today's AI-styled neutral streetwear look" className="absolute inset-0 h-full w-full object-cover object-[55%_25%] opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#172018]/95 via-[#172018]/55 to-transparent"/>
        <div className="relative z-10 flex min-h-[680px] max-w-xl flex-col justify-between p-7 sm:p-10 lg:p-14">
          <div className="flex items-center gap-2 text-xs text-white/70"><span className="rounded-full bg-white/10 px-3 py-1.5 backdrop-blur-md">AI-powered styling</span><span>·</span><span>{`${count} wardrobe items ready`}</span></div>
          <div>
            <Eyebrow light>Your wardrobe, reimagined</Eyebrow>
            <h1 className="font-serif text-6xl leading-[.88] tracking-[-.045em] sm:text-7xl lg:text-[96px]">Your AI<br/><i className="font-normal text-[#d8ff60]">Stylist.</i></h1>
            <p className="mt-6 max-w-md text-base leading-7 text-white/70">Tell us where you're going. We'll style what you already own and show you exactly how it looks on you.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button onClick={() => go("generator")} className="bg-[#d8ff60]! px-7 text-[#20251f]!">Create My Look <Icon name="arrow" size={18}/></Button>
              <Button onClick={() => go("add")} variant="cream"><Icon name="plus" size={18}/> Add Clothes</Button>
            </div>
          </div>
          <div className="flex w-fit items-center gap-3 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-lg">
            <Icon name="cloud" size={19}/><div><div className="text-xs font-semibold">{weather ? `${tempText(weather.tempC)} · ${weather.condition}` : me?.city ? "Checking the weather" : "Add your city"}</div><div className="mt-0.5 text-[10px] text-white/55">{weather?.advice ?? (me?.city ? me.city : "From your profile")}</div></div>
          </div>
        </div>
        {todaysPick && <button onClick={() => openLook(todaysPick.id)} className="absolute bottom-6 right-6 z-20 hidden w-72 overflow-hidden rounded-[24px] border border-white/30 bg-white/92 p-3 text-left text-[#20251f] shadow-2xl backdrop-blur-xl md:block">
          <div className="flex gap-3">
            <img src={todaysPick.imageUrl} alt="" className="h-24 w-20 rounded-2xl object-cover object-top"/>
            <div className="flex flex-1 flex-col justify-between py-1"><div><div className="text-[10px] font-bold uppercase tracking-wider text-[#737a70]">Today's pick</div><div className="mt-1 font-serif text-xl leading-5">{todaysPick.title}</div></div><div className="flex items-center gap-1 text-xs font-semibold">View your look <Icon name="arrow" size={14}/></div></div>
          </div>
        </button>}
      </div>
    </section>

    <section className="mx-auto max-w-[1440px] px-5 py-16 lg:px-10 lg:py-24">
      <SectionTitle eyebrow="Made from what you own" title="Your wardrobe, working harder." action={<Button onClick={() => go("wardrobe")} variant="ghost">{`View all ${count} `}<Icon name="arrow" size={16}/></Button>} />
      <div className="grid gap-4 md:grid-cols-12">
        <button onClick={() => go("wardrobe")} className="group relative min-h-80 overflow-hidden rounded-[28px] bg-[#e8e4da] text-left md:col-span-7">
          <img src={photos.wardrobe} alt="Your digital wardrobe" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"/>
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent"/>
          <div className="absolute bottom-0 p-7 text-white"><div className="text-xs uppercase tracking-wider text-white/70">Digital wardrobe</div><div className="mt-1 font-serif text-4xl">{count ? `${count} pieces. Endless looks.` : "Add your first piece."}</div></div>
        </button>
        <div className="grid gap-4 sm:grid-cols-2 md:col-span-5">
          {tiles.map(({ label: name, count, imageUrl: img }) => <button key={name} onClick={() => go("wardrobe")} className="group relative min-h-40 overflow-hidden rounded-[24px] bg-[#eeeae1] text-left">
            <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80 transition-transform duration-500 group-hover:scale-105"/>
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent"/>
            <div className="absolute bottom-4 left-4 text-white"><div className="font-serif text-2xl">{name}</div><div className="text-xs text-white/70">{count} items</div></div>
          </button>)}
        </div>
      </div>
    </section>

    <section className="bg-[#e9e5dc] py-16 lg:py-24">
      <div className="mx-auto max-w-[1440px] px-5 lg:px-10">
        <SectionTitle eyebrow={`Spotted in ${me?.city || "your city"}`} title="Trending near you." action={<Button onClick={() => go("trends")} variant="secondary">Explore trends</Button>}/>
        {trends.error && <ErrorNote>{trends.error.message}</ErrorNote>}
        <div className="grid gap-4 md:grid-cols-3">
          {(trends.data ?? []).slice(0, 3).map(({ id, name, subtitle: sub, imageUrl: img },i) => <button onClick={() => go("trends")} key={id} className={`group relative overflow-hidden rounded-[28px] text-left ${i === 1 ? "md:-translate-y-3" : ""}`}>
            <img src={img} alt={name} className="aspect-[4/5] w-full object-cover transition duration-700 group-hover:scale-105"/>
            <div className="absolute inset-x-3 bottom-3 rounded-[20px] bg-white/92 p-4 backdrop-blur-md"><div className="flex items-end justify-between"><div><div className="font-serif text-2xl">{name}</div><div className="text-xs text-[#737a70]">{sub}</div></div><span className="grid h-9 w-9 place-items-center rounded-full bg-[#d8ff60]"><Icon name="arrow" size={16}/></span></div></div>
          </button>)}
        </div>
      </div>
    </section>

    <section className="mx-auto grid max-w-[1440px] gap-5 px-5 py-16 lg:grid-cols-2 lg:px-10 lg:py-24">
      <button onClick={() => go("recommendations")} className="group flex min-h-96 flex-col justify-between overflow-hidden rounded-[30px] bg-[#c8b9aa] p-8 text-left sm:p-10">
        <div><Eyebrow>Complete your look</Eyebrow><div className="max-w-sm font-serif text-4xl leading-tight">One smart addition.<br/>More outfits from what you own.</div></div>
        <div className="flex items-end justify-between"><div className="flex -space-x-3">{[photos.clothes,photos.office,photos.rack].map((p,i)=><img key={p} src={p} alt="" className="h-16 w-16 rounded-full border-4 border-[#c8b9aa] object-cover" style={{zIndex:3-i}}/>)}</div><span className="grid h-12 w-12 place-items-center rounded-full bg-white transition group-hover:translate-x-1"><Icon name="arrow"/></span></div>
      </button>
      <button onClick={() => go("shopping")} className="group relative min-h-96 overflow-hidden rounded-[30px] bg-[#222820] p-8 text-left text-white sm:p-10">
        <img src={photos.group} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40 transition duration-700 group-hover:scale-105"/>
        <div className="absolute inset-0 bg-gradient-to-r from-[#222820]/90 to-transparent"/>
        <div className="relative flex h-full flex-col justify-between"><div><Eyebrow light>Need something new?</Eyebrow><div className="max-w-sm font-serif text-4xl leading-tight">Shop only what your wardrobe is missing.</div></div><div className="flex items-center gap-2 text-sm font-semibold">Ask your event assistant <Icon name="arrow" size={17}/></div></div>
      </button>
    </section>
  </main>;
}

function Generator({ generate, initial, error }: { generate: (data: LookRequest) => void; initial?: LookRequest; error?: string }) {
  const { me, stats, weather } = useAppData();
  // after a failed attempt the form comes back as it was, on the last step
  const [step, setStep] = useState(initial ? 3 : 1);
  const [occasion, setOccasion] = useState(initial?.occasion ?? "Casual outing");
  const [style, setStyle] = useState(initial?.style ?? "Let AI decide");
  const [location, setLocation] = useState(initial?.location ?? me?.city ?? "");
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [time, setTime] = useState(initial?.time ?? lookDefaults.time);
  return <main className="mx-auto max-w-5xl px-5 py-10 pb-36 lg:py-16">
    <div className="mb-10 flex items-center justify-between">
      <div><Eyebrow>AI Style Generator</Eyebrow><div className="font-serif text-5xl tracking-tight sm:text-6xl">Where are you going?</div><p className="mt-3 text-sm text-[#737a70]">A few details help your stylist create the right look.</p></div>
      <div className="hidden text-right sm:block"><div className="text-xs font-semibold">Step {step} of 3</div><div className="mt-2 flex gap-1.5">{[1,2,3].map(n=><span key={n} className={`h-1.5 w-9 rounded-full ${n<=step?"bg-[#20251f]":"bg-[#d9ddd5]"}`}/>)}</div></div>
    </div>
    <div className="rounded-[32px] border border-black/6 bg-white p-5 shadow-[0_20px_80px_rgba(28,35,27,.07)] sm:p-10">
      {step === 1 && <div>
        <div className="mb-5 text-sm font-semibold">Choose an occasion</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{occasions.map((o,i)=><button key={o} onClick={()=>setOccasion(o)} aria-pressed={occasion===o} className={`group flex min-h-28 flex-col items-start justify-between rounded-[20px] border p-4 text-left transition ${occasion===o?"border-[#20251f] bg-[#20251f] text-white":"border-[#e0e2dc] hover:border-[#aeb5aa]"}`}><span className={`grid h-8 w-8 place-items-center rounded-full text-xs ${occasion===o?"bg-[#d8ff60] text-[#20251f]":"bg-[#f0eee8]"}`}>{String(i+1).padStart(2,"0")}</span><span className="font-medium">{o}</span></button>)}</div>
      </div>}
      {step === 2 && <div className="grid gap-8 md:grid-cols-2">
        <label className="block"><span className="mb-3 flex items-center gap-2 text-sm font-semibold"><Icon name="pin" size={18}/> Where?</span><div className="flex rounded-2xl border border-[#d9ddd5] bg-[#f8f7f2] px-4"><input value={location} onChange={(e)=>setLocation(e.target.value)} className="min-h-14 w-full bg-transparent text-sm outline-none"/><Icon name="search" size={18}/></div><span className="mt-2 block text-xs text-[#737a70]">{weather ? `Weather: ${tempText(weather.tempC)}, ${weather.condition.toLowerCase()}` : "Weather is checked for this place and time"}</span></label>
        <div><span className="mb-3 flex items-center gap-2 text-sm font-semibold"><Icon name="calendar" size={18}/> When?</span><div className="grid grid-cols-2 gap-3"><label className="rounded-2xl border border-[#d9ddd5] bg-[#f8f7f2] p-4"><span className="text-[10px] uppercase text-[#737a70]">Date</span><input type="date" value={date} onChange={(e)=>setDate(e.target.value)} className="mt-1 w-full bg-transparent text-sm outline-none"/></label><label className="rounded-2xl border border-[#d9ddd5] bg-[#f8f7f2] p-4"><span className="text-[10px] uppercase text-[#737a70]">Time</span><input type="time" value={time} onChange={(e)=>setTime(e.target.value)} className="mt-1 w-full bg-transparent text-sm outline-none"/></label></div></div>
        <div className="rounded-[24px] bg-[#eef5d4] p-5 md:col-span-2"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#d8ff60]"><Icon name="sparkles" size={17}/></span><div><div className="text-sm font-semibold">Context added automatically</div><p className="mt-1 text-xs leading-5 text-[#5c625b]">Your stylist will consider the evening temperature, walking distance, and what's trending locally.</p></div></div></div>
      </div>}
      {step === 3 && <div><div className="mb-5 text-sm font-semibold">What's the mood?</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{styles.map((s,i)=><button key={s} onClick={()=>setStyle(s)} aria-pressed={style===s} className={`relative min-h-24 overflow-hidden rounded-[20px] border p-4 text-left font-medium transition ${style===s?"border-[#20251f] bg-[#20251f] text-white":"border-[#e0e2dc] hover:border-[#aeb5aa]"}`}>{s}{i===7&&<Icon name="sparkles" size={16}/>} {style===s&&<span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-[#d8ff60] text-[#20251f]"><Icon name="check" size={13}/></span>}</button>)}</div></div>}
      {error && <div className="mt-6"><ErrorNote>{error}</ErrorNote></div>}
      <div className="mt-10 flex justify-between border-t border-black/6 pt-6">
        <Button onClick={()=>setStep(Math.max(1,step-1))} variant="ghost" className={step===1?"invisible":""}>Back</Button>
        {step<3?<Button onClick={()=>setStep(step+1)}>Continue <Icon name="arrow" size={17}/></Button>:<Button onClick={()=>generate({occasion,style,location,date,time})} className="bg-[#d8ff60]! text-[#20251f]!"><Icon name="sparkles" size={18}/> Create my look</Button>}
      </div>
    </div>
    <div className="mt-6 text-center text-xs text-[#737a70]">{`AI uses your ${stats?.wardrobeCount ?? 0} wardrobe items · No shopping required`}</div>
  </main>;
}

const loadingMessages = ["Reading the weather...", "Exploring your wardrobe...", "Balancing color and silhouette...", "Visualizing your look..."];

function Loading() {
  const [message, setMessage] = useState(0);
  useEffect(() => {
    const m = window.setInterval(()=>setMessage(v=>Math.min(v+1,loadingMessages.length-1)),700);
    return ()=>clearInterval(m);
  },[]);
  return <main className="relative grid min-h-[calc(100vh-73px)] place-items-center overflow-hidden bg-[#20251f] px-5 pb-24 text-white">
    <div className="ai-orb absolute h-96 w-96 rounded-full bg-[#d8ff60]/20 blur-3xl"/>
    <div className="relative z-10 max-w-lg text-center">
      <div className="ai-rings mx-auto mb-12 grid h-44 w-44 place-items-center">
        <span className="absolute h-44 w-44 rounded-full border border-[#d8ff60]/20"/><span className="absolute h-32 w-32 rounded-full border border-[#d8ff60]/40"/><span className="grid h-20 w-20 place-items-center rounded-full bg-[#d8ff60] text-[#20251f] shadow-[0_0_70px_rgba(216,255,96,.35)]"><Icon name="sparkles" size={30}/></span>
      </div>
      <Eyebrow light>Wardrobe intelligence</Eyebrow>
      <div className="font-serif text-5xl leading-tight sm:text-6xl">Your AI stylist is<br/>creating your look...</div>
      <div className="mt-8 flex justify-center gap-2">{loadingMessages.map((_,i)=><span key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i<=message?"w-8 bg-[#d8ff60]":"w-4 bg-white/15"}`}/>)}</div>
      <p className="mt-4 text-sm text-white/55">{loadingMessages[message]}</p>
    </div>
  </main>;
}

function GeneratedLook({ look, setLook, occasion, retry }: { look: Look; setLook: (l: Look) => void; occasion: string; retry: () => void }) {
  const { refreshStats, me, setMe } = useAppData();
  const generatedLook = look;
  // AI photo when one exists, otherwise the model wearing the actual pieces
  const [view,setView]=useState<"photo"|"model">(look.hasPicture ? "photo" : "model");
  const [bodyOpen,setBodyOpen]=useState(false);
  useEffect(()=>{ if (look.hasPicture) setView("photo"); },[look.hasPicture]);
  const saved = look.saved;
  const [wearing,setWearing]=useState(false);
  const [changed,setChanged]=useState<number|null>(null);
  const [alternatives,setAlternatives]=useState<{ id: string }[]|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const toggleSave = () => run(async () => { const r = await api.save(look.id, !saved); setLook({ ...look, saved: r.saved }); refreshStats(); });
  const wear = () => run(async () => { await api.wear(look.id); setWearing(true); refreshStats(); });
  const regenerate = () => run(async () => {
    if (changed === null || !alternatives?.length) return;
    const next = await api.swap(look.id, look.items[changed].wardrobeItemId, alternatives[Math.floor(Math.random() * alternatives.length)].id);
    setLook(next); setChanged(null);
  });
  // "Change item": look up other pieces from the same category for the chosen item
  useEffect(() => {
    setAlternatives(null);
    if (changed === null || !look.items[changed]) return;
    let live = true;
    api.alternatives(look.id, look.items[changed].wardrobeItemId).then((r) => live && setAlternatives(r.alternatives)).catch(() => live && setAlternatives([]));
    return () => { live = false; };
  }, [changed, look.id, look.items]);
  // the image model works after the look is returned; check back until it settles
  useEffect(() => {
    if (look.visualizationStatus !== "pending") return;
    let tries = 0;
    const t = window.setInterval(() => {
      if (++tries > 20) return clearInterval(t);
      api.look(look.id).then((l) => { if (l.visualizationStatus !== "pending") { clearInterval(t); setLook(l); } }).catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [look.id, look.visualizationStatus, setLook]);
  return <main className="mx-auto max-w-[1440px] px-4 py-5 pb-36 sm:px-6 lg:px-10 lg:py-8">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><Eyebrow>Styled from your wardrobe</Eyebrow><div className="font-serif text-4xl tracking-tight sm:text-6xl">Your Look for <i className="font-normal">{occasion}</i></div></div>
      <div className="flex gap-2"><Button onClick={retry} variant="secondary"><Icon name="refresh" size={17}/> Try another</Button><Button onClick={toggleSave} variant={saved?"primary":"secondary"}><Icon name={saved?"check":"bookmark"} size={17}/>{saved?"Saved":"Save look"}</Button></div>
    </div>
    <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
      <section className="relative min-h-[720px] overflow-hidden rounded-[32px] bg-[#ded8cc]">
        {view==="photo" && look.hasPicture
          // the whole picture, head to shoes (cropping it to fill the box cut off the trousers and shoes),
          // over a blurred copy that fills the sides
          ? <><img src={generatedLook.visualizationUrl || photos.hero} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-90"/><img src={generatedLook.visualizationUrl || photos.hero} alt="AI visualization of you wearing the selected outfit" className="absolute inset-0 h-full w-full object-contain"/></>
          : <ModelView look={look} timeOfDay={look.timeOfDay}/>}
        <div className="absolute left-4 top-4 z-10 flex gap-1 rounded-full bg-white/85 p-1 text-[11px] font-semibold backdrop-blur sm:left-6 sm:top-6">
          {(["photo","model"] as const).map(v=><button key={v} onClick={()=>setView(v)} aria-pressed={view===v} className={`rounded-full px-3 py-1.5 ${view===v?"bg-[#20251f] text-white":""}`}>{v==="photo" ? (look.hasPicture ? "AI photo" : look.visualizationStatus==="pending" ? "AI photo · making..." : "AI photo · unavailable") : "Outfit board"}</button>)}
        </div>
        {look.visualizationStatus==="failed" && <div role="status" className="absolute left-4 top-16 z-10 flex max-w-[min(420px,85%)] items-start gap-3 rounded-2xl bg-white/90 px-3.5 py-2.5 text-[11px] leading-4 text-[#20251f] shadow-sm backdrop-blur sm:left-6 sm:top-[4.5rem]">
          <span className="flex-1 break-words">{look.visualizationError || "The picture couldn't be made this time."}</span>
          {/* the saved failure isn't final: draw it again (quota reset, deAPI back, ...) */}
          <button onClick={()=>{api.visualize(look.id).then(setLook).catch(()=>undefined);}} className="shrink-0 rounded-full bg-[#20251f] px-3 py-1.5 text-[10px] font-semibold text-white">Try again</button>
        </div>}
        {!me?.bodyProfile?.heightCm && <button onClick={()=>setBodyOpen(true)} className="absolute right-4 top-4 z-10 rounded-full bg-[#d8ff60] px-3 py-2 text-[11px] font-bold sm:right-6 sm:top-6">Add your body type</button>}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-6 pt-32 text-white sm:p-8">
          <div className="flex items-end justify-between gap-5">
            <div><div className="mb-2 flex w-fit items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-[10px] font-semibold backdrop-blur-md"><Icon name="wand" size={13}/> AI visualization</div><div className="font-serif text-3xl">{generatedLook.title}</div><div className="mt-1 text-xs text-white/65">{[generatedLook.timeOfDay, generatedLook.tempC == null ? null : `${generatedLook.tempC}°`, `${generatedLook.styleMatch}% style match`].filter(Boolean).join(" · ")}</div></div>
            <button aria-label="Take a photo in this look" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-[#20251f]"><Icon name="camera"/></button>
          </div>
        </div>
      </section>
      <div className="flex flex-col gap-5">
        <section className="rounded-[28px] bg-white p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between"><div className="font-serif text-2xl">The pieces</div><button className="text-xs font-semibold underline underline-offset-4" onClick={()=>setChanged(0)}>Change item</button></div>
          <div className="space-y-3">{generatedLook.items.map((item,i)=><div key={item.wardrobeItemId} className={`group flex items-center gap-3 rounded-[18px] border p-2.5 transition ${changed===i?"border-[#95ad48] bg-[#f5f9e9]":"border-[#ecece7]"}`}>
            <img src={item.studioUrl || item.imageUrl} alt="" className="h-16 w-14 rounded-xl bg-[#e2e8ea] object-cover"/>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{item.name}</div><div className="mt-1 text-[10px] text-[#737a70]">{item.meta}</div><div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-[#62732f]"><Icon name="check" size={11}/> From your wardrobe</div></div>
            <button onClick={()=>setChanged(changed===i?null:i)} aria-label={`Replace ${item.name}`} className="grid h-8 w-8 place-items-center rounded-full bg-[#f3f2ed] opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100"><Icon name="swap" size={14}/></button>
          </div>)}</div>
          {changed!==null&&<div className="mt-4 rounded-2xl bg-[#20251f] p-4 text-white"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-semibold">Try a different option?</div><div className="mt-1 text-[10px] text-white/55">{alternatives === null ? "Looking through your wardrobe..." : alternatives.length ? `AI found ${alternatives.length} compatible ${alternatives.length === 1 ? "piece" : "pieces"}.` : "No other pieces in this category yet."}</div></div><Button onClick={alternatives?.length ? regenerate : ()=>setChanged(null)} className={`bg-[#d8ff60]! px-4 py-2! text-[#20251f]! ${busy || alternatives === null ? "pointer-events-none opacity-50" : ""}`}>{alternatives?.length === 0 ? "Close" : "Regenerate"}</Button></div></div>}
        </section>
        {bodyOpen && <BodyProfileSheet me={me} onSaved={(m)=>{setMe(m);api.visualize(look.id).then(setLook).catch(()=>undefined);}} onClose={()=>setBodyOpen(false)}/>}
        <section className="rounded-[28px] bg-[#e6dfd4] p-6"><Eyebrow>Why it works</Eyebrow><p className="font-serif text-2xl leading-snug">{`“${generatedLook.reasoning}”`}</p><div className="mt-4 flex gap-2 text-[10px] font-semibold">{generatedLook.tags.map(t=><span key={t} className="rounded-full bg-white/60 px-3 py-1.5">{t}</span>)}</div></section>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button onClick={wearing ? undefined : wear} className="w-full py-4.5 text-base">{wearing?<><Icon name="check"/> Added to outfit calendar</>:<>Wear This <Icon name="arrow"/></>}</Button>
      </div>
    </div>
  </main>;
}

function Wardrobe({ go }: { go: (s: Screen)=>void }) {
  const { stats } = useAppData();
  const [category,setCategory]=useState("All items");
  const items = useApi(() => api.items(category), [category]);
  const wardrobeItems = items.data ?? [];
  const toggleFavorite = (id: string, favorite: boolean) => {
    items.setData(wardrobeItems.map((i) => (i.id === id ? { ...i, favorite } : i)));
    api.setFavorite(id, favorite).catch(() => items.reload());
  };
  // studio photos are made in the background, one item at a time: keep checking for about ten
  // minutes while some are missing (a new wardrobe takes several minutes)
  const missingStudio = wardrobeItems.some((i) => !i.studioUrl);
  const checks = useRef(0);
  useEffect(() => { checks.current = 0; }, [category]);
  useEffect(() => {
    if (!missingStudio || items.loading || checks.current >= 20) return;
    const t = window.setTimeout(() => { checks.current++; void items.reload(); }, 30000);
    return () => window.clearTimeout(t);
  }, [missingStudio, items.loading, items.data]);
  // a new studio photo takes a little while; the list is fetched again to pick it up
  const redoStudio = (id: string) => {
    api.redoStudio(id).then((updated) => {
      items.setData((list) => (list ?? []).map((i) => (i.id === id ? { ...i, ...updated } : i)));
      window.setTimeout(() => void items.reload(), 25000);
    }).catch(() => undefined);
  };
  const { cleaning, progress } = useBackgroundCleanup(wardrobeItems, (updated) =>
    items.setData((list) => (list ?? []).map((i) => (i.id === updated.id ? { ...i, ...updated } : i))));
  const racks = RACK_ORDER.map((c) => [c, wardrobeItems.filter((i) => i.category === c)] as const).filter(([, list]) => list.length);
  return <main className="mx-auto max-w-[1440px] px-5 py-10 pb-36 lg:px-10 lg:py-16">
    <div className="flex flex-wrap items-end justify-between gap-6"><div><Eyebrow>Your digital closet</Eyebrow><div className="font-serif text-5xl tracking-tight sm:text-6xl">Your Wardrobe <i className="font-normal text-[#838a80]">{`(${stats?.wardrobeCount ?? 0})`}</i></div><p className="mt-3 text-sm text-[#737a70]">Everything you own, understood by AI.</p></div><Button onClick={()=>go("add")}><Icon name="plus" size={18}/> Add new item</Button></div>
    <div className="no-scrollbar mt-10 flex gap-2 overflow-x-auto pb-2">{wardrobeCategories.map(c=><button key={c} onClick={()=>setCategory(c)} aria-pressed={category===c} className={`whitespace-nowrap rounded-full px-5 py-2.5 text-xs font-semibold transition ${category===c?"bg-[#20251f] text-white":"border border-[#d9ddd5] bg-white hover:border-[#aeb5aa]"}`}>{c}</button>)}</div>
    {progress && <div className="mt-6 flex items-center gap-3 rounded-[20px] bg-[#20251f] px-5 py-3.5 text-xs text-white"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#d8ff60] border-t-transparent"/><span className="flex-1">{`Giving your photos a clean background · ${progress.done} of ${progress.total}`}</span><span className="hidden text-white/50 sm:inline">The first one takes longer while the AI model downloads.</span></div>}
    {items.error && <div className="mt-8"><ErrorNote>{items.error.message}</ErrorNote></div>}
    {!items.loading && !items.error && !wardrobeItems.length && <button onClick={()=>go("add")} className="mt-8 flex w-full flex-col items-center rounded-[30px] border-2 border-dashed border-[#cbd0c7] bg-white p-12 text-center"><span className="grid h-14 w-14 place-items-center rounded-full bg-[#eef5d4]"><Icon name="camera" size={22}/></span><span className="mt-4 font-serif text-2xl">{category === "All items" ? "Your wardrobe is empty." : `No ${category.toLowerCase()} yet.`}</span><span className="mt-1 text-xs text-[#737a70]">Add a photo of something you own and AI will tag it.</span></button>}
    <div className="mt-10 space-y-12">{racks.map(([c, list]) => <Rack key={c} category={c} items={list} wrap={category !== "All items"} onFavorite={toggleFavorite} onRedo={redoStudio} cleaning={cleaning}/>)}</div>
  </main>;
}

type CutResult = { upload: { cutoutPath: string; imageUrl: string } } | { rejected: true } | { failed: true };

const scanLabels = ["Category", "Color", "Pattern", "Material", "Style", "Season"];

function AddItem({ done }: { done:()=>void }) {
  const { refreshStats } = useAppData();
  const [preview,setPreview]=useState("");
  const [itemScan,setItemScan]=useState<Scan|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  // background removal runs in the browser after the scan: working -> done (cutout) or kept (original)
  const [cut,setCut]=useState<"idle"|"working"|"done"|"kept">("idle");
  const cutJob=useRef<Promise<CutResult>|null>(null);
  const [original,setOriginal]=useState("");
  useEffect(()=>{warmUpCutouts()},[]);
  const scanned=!!itemScan;
  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setItemScan(null); setError(""); setBusy(true); setCut("idle"); cutJob.current = null;
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(file); });
    try {
      const photo = await shrinkPhoto(file);
      const scan = await api.scan(photo);
      setItemScan(scan); setOriginal(scan.imageUrl);
      if (!scan.item.cutoutPath) {
        setCut("working");
        const job: Promise<CutResult> = makeCutout(photo, scan.box)
          .then(async (png) => (png ? { upload: await api.uploadCutout(png) } : { rejected: true as const }))
          .catch(() => ({ failed: true as const }));
        cutJob.current = job;
        job.then((r) => {
          if (cutJob.current !== job) return;
          if ("upload" in r) { setItemScan((sc) => sc && { ...sc, imageUrl: r.upload.imageUrl, item: { ...sc.item, cutoutPath: r.upload.cutoutPath } }); setCut("done"); }
          else setCut("kept");
        });
      } else setCut("done");
    }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const keepOriginal = () => {
    cutJob.current = Promise.resolve({ rejected: true });
    setItemScan((sc) => sc && { ...sc, imageUrl: original, item: { ...sc.item, cutoutPath: null } }); setCut("kept");
  };
  const save = async () => {
    if (!itemScan) return;
    setBusy(true); setError("");
    try {
      // wait for the cleaned-up photo if it's still being made
      const r = cutJob.current ? await cutJob.current : null;
      const item = r && "upload" in r ? { ...itemScan.item, cutoutPath: r.upload.cutoutPath } : itemScan.item;
      const added = await api.addItem(item);
      // a cutout that failed the quality check: keep the original and don't offer cleanup again
      if (r && "rejected" in r) await api.setItemCutout(added.id, null).catch(() => undefined);
      refreshStats(); done();
    }
    catch (err) { setError((err as Error).message); setBusy(false); }
  };
  const attributes = itemScan?.attributes ?? scanLabels.map((k) => [k, ""] as [string, string]);
  return <main className="mx-auto max-w-4xl px-5 py-12 pb-36">
    <div className="text-center"><Eyebrow>Wardrobe scan</Eyebrow><div className="font-serif text-5xl sm:text-6xl">Add something you own.</div><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#737a70]">Snap or upload a clear photo. AI will remove the background and organize every detail.</p></div>
    <div className="mt-10 grid gap-5 md:grid-cols-2">
      <label className={`group relative grid min-h-[460px] cursor-pointer place-items-center overflow-hidden rounded-[30px] border-2 border-dashed border-[#cbd0c7] bg-white p-8 ${busy ? "pointer-events-none" : ""}`}>
        <input type="file" accept="image/*" onChange={pick} className="sr-only" aria-label="Upload a photo of a clothing item"/>
        {preview?<>{cut==="done"
          ? <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,#fbfaf7_0%,#efece5_55%,#e5e0d6_100%)]"><img src={itemScan?.imageUrl} alt="Uploaded clothing with a clean background" className="absolute inset-8 h-[calc(100%-4rem)] w-[calc(100%-4rem)] object-contain drop-shadow-[0_14px_14px_rgba(40,35,25,0.22)]"/></div>
          : <><img src={itemScan?.imageUrl || preview} alt="Uploaded clothing" className="absolute inset-0 h-full w-full object-cover"/><div className="absolute inset-0 bg-black/20"/></>}
          <span className={`relative rounded-full bg-[#d8ff60] px-4 py-2 text-xs font-bold ${cut==="done"?"self-end":""}`}>{busy && !scanned ? "Scanning..." : cut==="working" ? "Removing background..." : cut==="done" ? "Background removed" : scanned ? "Scan complete" : "Tap to try another photo"}</span></>:<div><span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef5d4] transition-transform group-hover:scale-110"><Icon name="camera" size={25}/></span><div className="mt-5 font-serif text-2xl">Drop a photo here</div><div className="mt-2 text-xs text-[#737a70]">or tap to use camera</div></div>}
      </label>
      <div className="rounded-[30px] bg-[#20251f] p-7 text-white">
        <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-[#d8ff60] text-[#20251f]"><Icon name="sparkles" size={18}/></span><div><div className="text-sm font-semibold">AI item details</div><div className="text-[10px] text-white/45">{scanned?`Identified in ${itemScan.durationSec} seconds`:busy?"Reading your photo...":"Waiting for image"}</div></div></div>
        <div className="mt-8 space-y-3">{attributes.map(([k,v],i)=><div key={k} className={`flex justify-between border-b border-white/10 py-3 text-sm transition-all duration-500 ${scanned?"translate-y-0 opacity-100":"translate-y-2 opacity-25"}`} style={{transitionDelay:`${i*80}ms`}}><span className="text-white/45">{k}</span><span>{scanned?v:"—"}</span></div>)}</div>
        {error && <div className="mt-6"><ErrorNote light>{error}</ErrorNote></div>}
        {cut==="done" && <button onClick={keepOriginal} className="mt-6 text-xs text-white/60 underline underline-offset-4">Keep the original background instead</button>}
        <Button onClick={save} className={`mt-8 w-full bg-[#d8ff60]! text-[#20251f]! ${!scanned||busy?"pointer-events-none opacity-30":""}`}><Icon name="plus" size={17}/> {busy && cut==="working" ? "Finishing the clean background..." : "Add to wardrobe"}</Button>
      </div>
    </div>
  </main>;
}

function Recommendations({ go }: { go:(s:Screen)=>void }) {
  const rec = useApi(api.recommendation);
  const recommendation = rec.data;
  return <main className="mx-auto max-w-[1200px] px-5 py-12 pb-36 lg:py-16">
    <div className="max-w-2xl"><Eyebrow>Smart recommendations</Eyebrow><div className="font-serif text-5xl sm:text-6xl">Complete Your Look.</div><p className="mt-4 text-sm leading-6 text-[#737a70]">Thoughtful additions that unlock more combinations—not more clutter.</p></div>
    {!recommendation && <section className="mt-10 flex min-h-[320px] flex-col items-center justify-center rounded-[32px] bg-[#ded7ca] p-10 text-center">
      {rec.error ? <><div className="font-serif text-3xl">{rec.error instanceof ApiError && rec.error.status === 409 ? "Add a few more pieces first." : "Your stylist is busy right now."}</div><p className="mt-2 max-w-sm text-sm text-[#5c625b]">{rec.error.message}</p><Button className="mt-6" onClick={() => (rec.error instanceof ApiError && rec.error.status === 409 ? go("add") : rec.reload())}>{rec.error instanceof ApiError && rec.error.status === 409 ? "Add clothes" : "Try again"} <Icon name="arrow" size={17}/></Button></> : <><span className="grid h-12 w-12 animate-pulse place-items-center rounded-full bg-[#d8ff60]"><Icon name="sparkles" size={20}/></span><div className="mt-4 font-serif text-3xl">Looking through your wardrobe...</div></>}
    </section>}
    {recommendation && <section className="mt-10 overflow-hidden rounded-[32px] bg-[#ded7ca]">
      <div className="grid lg:grid-cols-2"><div className="p-7 sm:p-10"><div className="text-xs font-bold uppercase tracking-wider text-[#737a70]">You already own</div><div className="mt-2 font-serif text-4xl">{recommendation.ownedItemName}</div><p className="mt-3 max-w-md text-sm leading-6 text-[#5c625b]">{recommendation.description}</p>
        <div className="my-8 flex items-center gap-4"><img src={recommendation.ownedItemImageUrl} className="h-28 w-24 rounded-[20px] object-cover" alt={recommendation.ownedItemName}/><span className="font-serif text-3xl">+</span><img src={recommendation.suggestedImageUrl} className="h-28 w-24 rounded-[20px] object-cover" alt={recommendation.productName}/></div>
        <div className="grid grid-cols-3 gap-2">{[[recommendation.estimatedPrice,"Estimated"],[`${recommendation.styleMatch}%`,"Style match"],[String(recommendation.newLooks),"New looks"]].map(([a,b])=><div key={b} className="rounded-2xl bg-white/55 p-3"><div className="font-serif text-xl">{a}</div><div className="text-[9px] uppercase text-[#737a70]">{b}</div></div>)}</div>
        <Button className="mt-7" onClick={() => window.open(`https://www.google.com/search?tbm=shop&q=${encodeURIComponent(recommendation.productName)}`, "_blank", "noopener")}>View product <Icon name="arrow" size={17}/></Button>
      </div><div className="relative min-h-[520px]"><img src={recommendation.visualizationUrl} alt="How the recommended outfit looks on you" className="absolute inset-0 h-full w-full object-cover object-top"/><div className="absolute inset-x-4 bottom-4 rounded-[20px] bg-white/90 p-4 backdrop-blur"><div className="text-[10px] font-bold uppercase tracking-wider text-[#737a70]">See it on you</div><div className="mt-1 font-serif text-2xl">Balanced, effortless, yours.</div></div></div></div>
    </section>}
    <button onClick={()=>go("shopping")} className="mt-5 flex w-full items-center justify-between rounded-[24px] bg-[#20251f] p-6 text-left text-white"><div><div className="font-serif text-2xl">Shopping for an occasion?</div><div className="mt-1 text-xs text-white/55">Let AI find only what you're missing.</div></div><span className="grid h-10 w-10 place-items-center rounded-full bg-[#d8ff60] text-[#20251f]"><Icon name="arrow" size={17}/></span></button>
  </main>;
}

function Shopping() {
  const [answer,setAnswer]=useState<typeof sampleAdvice|null>(null);
  const [prompt,setPrompt]=useState(shoppingDefaultPrompt);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const asked=!!answer;
  // the example answer shows (dimmed) until the first real one arrives
  const shoppingAdvice=answer ?? sampleAdvice;
  const ask = async () => {
    setBusy(true); setError("");
    try { setAnswer(await api.ask(prompt)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <main className="mx-auto max-w-[1200px] px-5 py-12 pb-36 lg:py-16">
    <div className="grid gap-10 lg:grid-cols-[.85fr_1.15fr]">
      <div><Eyebrow>Function assistant</Eyebrow><div className="font-serif text-5xl leading-tight sm:text-6xl">Need Something New?</div><p className="mt-4 text-sm leading-6 text-[#737a70]">Your wardrobe is always checked first, so every purchase has a purpose.</p>
        <div className="mt-8 rounded-[24px] bg-white p-4 shadow-sm"><textarea value={prompt} onChange={(e)=>setPrompt(e.target.value)} aria-label="Ask your stylist" className="h-28 w-full resize-none bg-transparent p-2 text-base outline-none"/><div className="flex justify-end"><Button onClick={busy ? undefined : ask} className={busy ? "opacity-60" : ""}><Icon name="sparkles" size={16}/> {busy ? "Thinking..." : "Ask my stylist"}</Button></div></div>
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        <div className="mt-5 rounded-[24px] bg-[#e8e2d7] p-6"><div className="text-xs font-bold uppercase tracking-wider text-[#737a70]">{asked ? "You already have" : "For example, you already have"}</div><div className="mt-4 space-y-3">{shoppingAdvice.ownedItems.map(x=><div key={x} className="flex items-center gap-3 text-sm"><span className="grid h-6 w-6 place-items-center rounded-full bg-white"><Icon name="check" size={12}/></span>{x}</div>)}</div></div>
      </div>
      <div className={`transition duration-700 ${asked?"opacity-100":"opacity-70"}`}><div className="relative min-h-[580px] overflow-hidden rounded-[32px] bg-[#1f261f]"><img src={shoppingAdvice.visualizationUrl || photos.group} alt="Outfit visualization" className="absolute inset-0 h-full w-full object-cover opacity-75"/><div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent"/><div className="absolute inset-x-0 bottom-0 p-7 text-white"><div className="text-[10px] font-bold uppercase tracking-wider text-[#d8ff60]">{asked?"Your wardrobe gap":"Example wardrobe gap"}</div><div className="mt-2 font-serif text-4xl">{shoppingAdvice.gapTitle}</div><p className="mt-2 text-xs leading-5 text-white/65">{shoppingAdvice.gapDescription}</p><div className="mt-5 flex gap-2"><Button className="bg-[#d8ff60]! text-[#20251f]!">View recommendations</Button><Button variant="cream">See it on me</Button></div></div></div></div>
    </div>
  </main>;
}

function Trends({ go }: { go:(s:Screen)=>void }) {
  const { me } = useAppData();
  const list = useApi(api.trends, [me?.city]);
  const trends = list.data ?? [];
  return <main className="mx-auto max-w-[1440px] px-5 py-12 pb-36 lg:px-10 lg:py-16">
    <div className="flex flex-wrap items-end justify-between gap-5"><div><Eyebrow>Personalized trend report</Eyebrow><div className="font-serif text-5xl sm:text-6xl">Trending Looks.</div><p className="mt-3 text-sm text-[#737a70]">Current style, translated through clothes you already own.</p></div><div className="rounded-full bg-[#eef5d4] px-4 py-2 text-xs font-semibold">{`Updated for ${me?.city || "your city"}`}</div></div>
    {list.loading && !trends.length && <div className="mt-10 text-sm text-[#737a70]">Finding what's trending near you...</div>}
    {list.error && <div className="mt-10"><ErrorNote>{list.error.message}</ErrorNote></div>}
    <div className="mt-10 grid gap-4 md:grid-cols-2">{trends.map(({ id, name, subtitle: sub, imageUrl: img },i)=><button onClick={()=>go("generator")} key={id} className={`group relative min-h-[480px] overflow-hidden rounded-[30px] text-left ${i===1||i===2?"md:min-h-[400px]":""}`}><img src={img} alt={name} className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105"/><div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"/><div className="absolute inset-x-0 bottom-0 p-7 text-white"><div className="text-[10px] font-bold uppercase tracking-wider text-[#d8ff60]">Trending now · {sub}</div><div className="mt-1 font-serif text-4xl">{name}</div><div className="mt-3 flex items-center gap-2 text-xs font-semibold">Try this with clothes you own <Icon name="arrow" size={16}/></div></div></button>)}</div>
  </main>;
}

function Profile({ go, signOut }: { go:(s:Screen)=>void; signOut: () => void }) {
  const { me, stats, setMe, refreshWeather } = useAppData();
  const user = { name: me?.name || me?.email || "", city: me?.city || "", profileCompletion: me?.profileCompletion ?? 0, styleDna: me?.styleDna || "Your style DNA builds as you add clothes and style looks.", styleTags: me?.styleTags ?? [] };
  const [error,setError]=useState("");
  const changeCity = async () => {
    const city = window.prompt("Which city should weather and trends use?", user.city)?.trim();
    if (!city || city === user.city) return;
    setError("");
    try { setMe(await api.updateMe({ city })); refreshWeather(); }
    catch (e) { setError((e as Error).message); }
  };
  const [bodyOpen,setBodyOpen]=useState(false);
  const actions: Record<string, (() => void) | undefined> = { "Body & fit profile": ()=>setBodyOpen(true), "Weather & location": changeCity, "Sign out": signOut };
  return <main className="mx-auto max-w-4xl px-5 py-12 pb-36">
    <div className="flex flex-col items-center text-center"><Avatar className="h-28 w-28 rounded-full object-cover text-5xl ring-4 ring-white shadow-xl"/><div className="mt-5 font-serif text-4xl">{user.name}</div><div className="mt-1 text-xs text-[#737a70]">{`${user.city || "No city set"} · Style profile ${user.profileCompletion}% complete`}</div></div>
    <div className="mt-10 grid grid-cols-3 gap-3">{[[stats?.wardrobeCount ?? 0,"Wardrobe"],[stats?.savedLooks ?? 0,"Saved looks"],[stats?.daysStyled ?? 0,"Days styled"]].map(([a,b])=><div key={b} className="rounded-[22px] bg-white p-5 text-center"><div className="font-serif text-3xl">{a}</div><div className="text-[10px] uppercase tracking-wider text-[#737a70]">{b}</div></div>)}</div>
    <div className="mt-5 rounded-[28px] bg-[#20251f] p-7 text-white"><Eyebrow light>Your style DNA</Eyebrow><div className="font-serif text-3xl">{user.styleDna}</div><div className="mt-6 flex flex-wrap gap-2">{user.styleTags.map(x=><span key={x} className="rounded-full border border-white/15 px-3 py-2 text-xs text-white/65">{x}</span>)}</div></div>
    <div className="mt-5 overflow-hidden rounded-[24px] bg-white">{([["Style preferences","sparkles"],["Body & fit profile","user"],["Weather & location","pin"],["App settings","settings"],["Sign out","arrow"]] as [string,IconName][]).map(([label,icon])=><button key={label} onClick={actions[label]} className="flex w-full items-center gap-4 border-b border-black/5 p-5 text-left last:border-0"><span className="grid h-9 w-9 place-items-center rounded-full bg-[#f1f0eb]"><Icon name={icon} size={17}/></span><span className="flex-1 text-sm font-semibold">{label}</span><Icon name="chevron" size={16}/></button>)}</div>
    {error && <div className="mt-5"><ErrorNote>{error}</ErrorNote></div>}
    <Button onClick={()=>go("generator")} className="mt-5 w-full bg-[#d8ff60]! text-[#20251f]!"><Icon name="sparkles"/> Style me now</Button>
    {bodyOpen && <BodyProfileSheet me={me} onSaved={setMe} onClose={()=>setBodyOpen(false)}/>}
  </main>;
}

export default function App() {
  const [signedIn,setSignedIn]=useState(()=>!!getSession());
  useEffect(()=>{
    const sync=()=>setSignedIn(!!getSession());
    window.addEventListener("wardrobe-ai:session",sync);
    return ()=>window.removeEventListener("wardrobe-ai:session",sync);
  },[]);
  return signedIn ? <SignedInApp/> : <SignIn/>;
}

function SignedInApp() {
  const [screen,setScreen]=useState<Screen>("home");
  const screenRef=useRef(screen);
  screenRef.current=screen;
  const [occasion,setOccasion]=useState("Casual outing");
  const [request,setRequest]=useState<LookRequest>();
  const [look,setLook]=useState<Look|null>(null);
  const [genError,setGenError]=useState("");
  const me=useApi(api.me);
  const stats=useApi(api.stats);
  const weather=useApi(()=>me.data?.city?api.weather():Promise.resolve(undefined),[me.data?.city]);
  const go=useCallback((s:Screen)=>{setScreen(s);window.scrollTo({top:0,behavior:"smooth"})},[]);
  // "Create my look" and "Try another": the loading screen stays up for its full animation and until the look is back
  const generate=(data:LookRequest)=>{
    setRequest(data);setOccasion(data.occasion);setGenError("");go("loading");
    const minimum=new Promise((r)=>setTimeout(r,3200));
    Promise.all([api.generate(data),minimum])
      .then(([l])=>{setLook(l);if(screenRef.current==="loading")go("look")})
      .catch((e:Error)=>{setGenError(e.message);if(screenRef.current==="loading")go("generator")});
  };
  const openLook=(id:string)=>{
    api.look(id).then((l)=>{setLook(l);setOccasion((l as Look & {occasion?:string}).occasion ?? occasion);go("look")}).catch(()=>undefined);
  };
  const signOut=()=>{void api.logout()};
  const data: AppData = {
    me: me.data, stats: stats.data, weather: weather.data,
    setMe: me.setData, refreshStats: ()=>void stats.reload(), refreshWeather: ()=>void weather.reload(),
  };
  let content: ReactNode;
  if(screen==="home") content=<Home go={go} openLook={openLook}/>;
  else if(screen==="generator") content=<Generator generate={generate} initial={genError?request:undefined} error={genError}/>;
  else if(screen==="loading") content=<Loading/>;
  else if(screen==="look") content=look?<GeneratedLook look={look} setLook={setLook} occasion={occasion} retry={()=>request?generate(request):go("generator")}/>:<Generator generate={generate}/>;
  else if(screen==="wardrobe") content=<Wardrobe go={go}/>;
  else if(screen==="add") content=<AddItem done={()=>go("wardrobe")}/>;
  else if(screen==="recommendations") content=<Recommendations go={go}/>;
  else if(screen==="shopping") content=<Shopping/>;
  else if(screen==="trends") content=<Trends go={go}/>;
  else content=<Profile go={go} signOut={signOut}/>;
  return <AppDataContext.Provider value={data}><div className="min-h-screen bg-[#f8f7f2] text-[#20251f]"><TopBar onProfile={()=>go("profile")}/>{content}<BottomNav screen={screen} go={go}/></div></AppDataContext.Provider>;
}
