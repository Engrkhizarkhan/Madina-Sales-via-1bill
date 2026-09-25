import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Armchair,
  BadgeCheck,
  Banknote,
  BookOpenCheck,
  Bus,
  BusFront,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  FileBarChart,
  FileText,
  Gauge,
  Headphones,
  KeyRound,
  LockKeyhole,
  LogOut,
  MapPin,
  MapPinned,
  Menu,
  Navigation,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  Route,
  Search,
  Settings,
  ShieldCheck,
  Ticket,
  Trash2,
  UserRound,
  UserRoundCog,
  UsersRound,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import "./App.css";
import { api, ApiError } from "./api";

type PaymentMethod = "Cash" | "Card" | "Bank transfer" | "1Bill";
type PaymentStatus = "Paid" | "Unpaid" | "Partially refunded" | "Refunded";
type BookingStatus = "Confirmed" | "Reserved" | "Cancelled" | "Refunded";
type BookingSource = "Public web" | "Counter";
type RefundReason =
  | "Passenger request"
  | "Trip cancelled"
  | "Duplicate payment"
  | "Service disruption"
  | "Other";
type RefundTransaction = {
  releaseSeats?: boolean;
  id: string;
  amount: number;
  method: PaymentMethod;
  reason: RefundReason;
  reference: string;
  notes: string;
  processedAt: string;
  processedBy: string;
};
type AdminView =
  | "dashboard"
  | "sale"
  | "bookings"
  | "reservations"
  | "trips"
  | "fleet"
  | "routes"
  | "finance"
  | "expenses"
  | "reports"
  | "crew"
  | "settings";

type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
type ReportKind = "manifest" | "cnic" | "terminal-a4" | "terminal-thermal";

type RouteRecord = {
  id: string;
  from: string;
  to: string;
  distance: string;
  duration: string;
  fare: number;
  boarding: string;
  status: "Active" | "Paused";
};
type CrewRecord = {
  id?: number;
  name: string;
  role: "Driver" | "Female attendant" | "Manager" | "Counter agent";
  phone: string;
  cnic: string;
  license: string;
  duty: string;
  status: "On duty" | "Available" | "Scheduled" | "Off duty";
  initials: string;
};
type BusRecord = {
  id: string;
  registration: string;
  service: string;
  seats: number;
  model: string;
  year: number;
  status: "On route" | "Ready" | "Maintenance" | "Retired";
  nextService: string;
};
type TripRecord = {
  id: string;
  routeId: string;
  busId: string;
  departure: string;
  arrival: string;
  driver: string;
  attendant: string;
  platform: string;
  status: "Boarding" | "Scheduled" | "Departed" | "Returned" | "Cancelled";
  snapshot?: { routeId: string; departure: string; arrival: string; route: RouteRecord; bus: BusRecord; passengers?: Booking[] };
  departedAt?: string;
  returnedAt?: string;
  notes?: string;
  days: Weekday[];
  active: boolean;
  runNumber: number;
  lastDepartedAt?: string;
};
type TripRun = {
  id: string;
  tripId: string;
  date: string;
  runNumber: number;
  busId: string;
  driver: string;
  attendant: string;
  platform: string;
  status: TripRecord["status"];
  snapshot?: TripRecord["snapshot"];
  returnedAt?: string;
  notes: string;
  boardingStartedAt?: string;
  departedAt?: string;
};
type Booking = {
  id: string;
  ticketNo: string;
  source: BookingSource;
  passenger: string;
  phone: string;
  cnic: string;
  gender: "Male" | "Female";
  route: string;
  destination: string;
  boardingPoint: string;
  bus: string;
  service: string;
  seats: number[];
  fare: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  paymentMethod: PaymentMethod;
  paymentReference: string;
  paymentStatus: PaymentStatus;
  bookingStatus: BookingStatus;
  date: string;
  time: string;
  driver: string;
  attendant: string;
  createdAt: string;
  expiresAt?: string;
  tripId?: string;
  tripRunId?: string;
  seatPrintedAt?: string;
  issuedBy?: string;
  terminal?: string;
  refunds?: RefundTransaction[];
};
type StaffUser = {
  id: number;
  name: string;
  email: string;
  username: string;
  role: "admin" | "manager" | "counter" | "dispatcher" | "finance";
  forcePasswordChange: boolean;
  active?: boolean;
  lastLoginAt?: string;
  createdAt?: string;
};
type ExpenseRecord = {
  id: number;
  date: string;
  category: string;
  description: string;
  amount: number;
  paymentMethod: "Cash" | "Card" | "Bank transfer";
  reference: string;
  notes: string;
  createdBy: string;
  createdAt: string;
};
type PublicOccupancy = {
  tripRunId: string;
  bus: string;
  date: string;
  time: string;
  seats: number[];
};
type PublicBootstrap = {
  trips: TripRecord[];
  fleet: BusRecord[];
  routes: RouteRecord[];
  occupancy: PublicOccupancy[];
  paymentMode: string;
};
type AdminBootstrap = {
  runs: TripRun[];
  bookings: Booking[];
  fleet: BusRecord[];
  trips: TripRecord[];
  routes: RouteRecord[];
  crew: CrewRecord[];
  users: StaffUser[];
  user: StaffUser;
  paymentMode: string;
};
type PassengerForm = {
  passenger: string;
  phone: string;
  cnic: string;
  idType: "CNIC" | "Passport";
  gender: "Male" | "Female";
  boardingPoint: string;
  fare: number;
  discount: number;
  paymentMethod: PaymentMethod;
  paymentReference: string;
};

const dateInPakistan = (value: Date | string = new Date()) =>
  new Date(value).toLocaleDateString("en-CA", {
    timeZone: "Asia/Karachi",
  });
const today = dateInPakistan();
const weekdays: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const routeRecords: RouteRecord[] = [
  {
    id: "psh-khi",
    from: "Peshawar",
    to: "Karachi",
    distance: "1,380 km",
    duration: "14h 00m",
    fare: 7000,
    boarding: "Madina Terminal, Peshawar",
    status: "Active",
  },
  {
    id: "psh-lhr",
    from: "Peshawar",
    to: "Lahore",
    distance: "520 km",
    duration: "5h 45m",
    fare: 4200,
    boarding: "Madina Terminal, Peshawar",
    status: "Active",
  },
  {
    id: "psh-isb",
    from: "Peshawar",
    to: "Islamabad",
    distance: "185 km",
    duration: "2h 30m",
    fare: 1800,
    boarding: "Madina Terminal, Peshawar",
    status: "Active",
  },
  {
    id: "psh-mul",
    from: "Peshawar",
    to: "Multan",
    distance: "690 km",
    duration: "7h 30m",
    fare: 4500,
    boarding: "Madina Terminal, Peshawar",
    status: "Active",
  },
  {
    id: "khi-psh",
    from: "Karachi",
    to: "Peshawar",
    distance: "1,380 km",
    duration: "14h 15m",
    fare: 7000,
    boarding: "Sohrab Goth Terminal, Karachi",
    status: "Active",
  },
  {
    id: "lhr-psh",
    from: "Lahore",
    to: "Peshawar",
    distance: "520 km",
    duration: "5h 45m",
    fare: 4200,
    boarding: "Thokar Niaz Baig, Lahore",
    status: "Active",
  },
];
const initialBookings: Booking[] = [
  {
    id: "seed-1",
    ticketNo: "ME-260902-1426",
    source: "Public web",
    passenger: "Usman Ali",
    phone: "0301 8472210",
    cnic: "17301-4581266-3",
    gender: "Male",
    route: "Peshawar → Karachi",
    destination: "Karachi",
    boardingPoint: "Madina Terminal, Peshawar",
    bus: "TAE-388",
    service: "Standard Plus",
    seats: [11],
    fare: 7000,
    discount: 0,
    total: 7000,
    paid: 7000,
    balance: 0,
    paymentMethod: "1Bill",
    paymentReference: "1B-90281426",
    paymentStatus: "Paid",
    bookingStatus: "Confirmed",
    date: today,
    time: "16:00",
    driver: "Muhammad Ameen",
    attendant: "Ayesha Khan",
    createdAt: new Date().toISOString(),
  },
  {
    id: "seed-2",
    ticketNo: "ME-260902-1398",
    source: "Counter",
    passenger: "Sanaullah Khan",
    phone: "0333 5218490",
    cnic: "17301-1592366-5",
    gender: "Male",
    route: "Peshawar → Karachi",
    destination: "Karachi",
    boardingPoint: "Madina Terminal, Peshawar",
    bus: "TAE-388",
    service: "Standard Plus",
    seats: [14, 15],
    fare: 7000,
    discount: 500,
    total: 13500,
    paid: 13500,
    balance: 0,
    paymentMethod: "Cash",
    paymentReference: "POS-1398",
    paymentStatus: "Paid",
    bookingStatus: "Confirmed",
    date: today,
    time: "16:00",
    driver: "Muhammad Ameen",
    attendant: "Ayesha Khan",
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "seed-3",
    ticketNo: "RS-260902-1311",
    source: "Counter",
    passenger: "Maria Khan",
    phone: "0312 9908412",
    cnic: "17301-7421068-4",
    gender: "Female",
    route: "Peshawar → Lahore",
    destination: "Lahore",
    boardingPoint: "Madina Terminal, Peshawar",
    bus: "LES-221",
    service: "Sleeper Bus",
    seats: [22],
    fare: 4200,
    discount: 0,
    total: 4200,
    paid: 0,
    balance: 4200,
    paymentMethod: "Cash",
    paymentReference: "",
    paymentStatus: "Unpaid",
    bookingStatus: "Reserved",
    date: today,
    time: "19:00",
    driver: "Faisal Khan",
    attendant: "Sadia Noor",
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    expiresAt: new Date(Date.now() + 5400000).toISOString(),
  },
  {
    id: "seed-4",
    ticketNo: "ME-260902-1264",
    source: "Counter",
    passenger: "Rashid Mehmood",
    phone: "0345 8821034",
    cnic: "35202-8810341-7",
    gender: "Male",
    route: "Peshawar → Islamabad",
    destination: "Islamabad",
    boardingPoint: "Madina Terminal, Peshawar",
    bus: "TAJ-977",
    service: "Executive",
    seats: [7],
    fare: 1800,
    discount: 0,
    total: 1800,
    paid: 1800,
    balance: 0,
    paymentMethod: "Card",
    paymentReference: "CARD-8821",
    paymentStatus: "Paid",
    bookingStatus: "Confirmed",
    date: today,
    time: "09:00",
    driver: "Adeel Shah",
    attendant: "Nazia Bibi",
    createdAt: new Date(Date.now() - 10800000).toISOString(),
  },
];
const crewRecords: CrewRecord[] = [
  {
    name: "Muhammad Ameen",
    role: "Driver",
    phone: "0300 1122456",
    cnic: "17301-2481162-1",
    license: "HTV-PSH-10428",
    duty: "Peshawar → Karachi",
    status: "On duty",
    initials: "MA",
  },
  {
    name: "Adeel Shah",
    role: "Driver",
    phone: "0304 3310098",
    cnic: "17301-8842160-7",
    license: "HTV-PSH-11802",
    duty: "Available at terminal",
    status: "Available",
    initials: "AS",
  },
  {
    name: "Ayesha Khan",
    role: "Female attendant",
    phone: "0315 6621908",
    cnic: "17301-6621908-4",
    license: "—",
    duty: "Peshawar → Karachi",
    status: "On duty",
    initials: "AK",
  },
  {
    name: "Nazia Bibi",
    role: "Female attendant",
    phone: "0332 5514402",
    cnic: "17301-5514402-8",
    license: "—",
    duty: "Available at terminal",
    status: "Available",
    initials: "NB",
  },
  {
    name: "Faisal Khan",
    role: "Driver",
    phone: "0307 9912045",
    cnic: "17301-9912045-2",
    license: "HTV-PSH-12561",
    duty: "Peshawar → Lahore",
    status: "Scheduled",
    initials: "FK",
  },
  {
    name: "Sadia Noor",
    role: "Female attendant",
    phone: "0318 7441280",
    cnic: "17301-7441280-5",
    license: "—",
    duty: "Peshawar → Lahore",
    status: "Scheduled",
    initials: "SN",
  },
];
void routeRecords;
void crewRecords;

const money = (value: number) =>
  `${value < 0 ? "− " : ""}PKR ${Math.abs(value).toLocaleString("en-PK")}`;
const routeLabel = (route: RouteRecord) => `${route.from} → ${route.to}`;
const tripRunKey = (
  trip: TripRecord,
  run = trip.runNumber,
  serviceDate = today,
) => `${trip.id}-${serviceDate}-run-${run}`;
function bookingsForTripRun(
  bookings: Booking[],
  trip: TripRecord,
  bus: BusRecord,
  runNumber = trip.runNumber,
  serviceDate = today,
) {
  const key = tripRunKey(trip, runNumber, serviceDate);
  return bookings.filter(
    (booking) =>
      booking.bookingStatus === "Confirmed" &&
      (booking.tripRunId
        ? booking.tripRunId === key
        : runNumber === 1 &&
          booking.bus === bus.registration &&
          booking.date === serviceDate &&
          booking.time === trip.departure),
  );
}
const formatPrintTime = (value?: string) =>
  value
    ? new Date(value).toLocaleString("en-PK", {
        timeZone: "Asia/Karachi",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const tripOnDate = (trip: TripRecord, date: string, runs: TripRun[]): TripRecord => {
  const run = runs.find((item) => item.tripId === trip.id && item.date === date);
  return run ? { ...trip, ...run.snapshot, status: run.status, runNumber: run.runNumber, busId: run.busId, driver: run.driver, attendant: run.attendant, platform: run.platform, snapshot: run.snapshot, departedAt: run.departedAt, returnedAt: run.returnedAt, notes: run.notes } : { ...trip, status: "Scheduled", runNumber: 1 };
};
const tripBus = (trip: TripRecord, fleet: BusRecord[]) => trip.snapshot?.bus ?? fleet.find((bus) => bus.id === trip.busId)!;
const tripRoute = (trip: TripRecord, routes: RouteRecord[]) => trip.snapshot?.route ?? routes.find((route) => route.id === trip.routeId)!;
const serviceDayFor = (date: string) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${date}T12:00:00`).getDay()] as Weekday;
const tripsOnDate = (trips: TripRecord[], date: string, runs: TripRun[]) =>
  trips.filter((trip) => trip.days.includes(serviceDayFor(date)) || runs.some((run) => run.tripId === trip.id && run.date === date))
    .map((trip) => tripOnDate(trip, date, runs));
const refundedTotal = (booking: Booking) =>
  (booking.refunds ?? []).reduce((sum, refund) => sum + refund.amount, 0);
const refundableBalance = (booking: Booking) =>
  Math.max(0, booking.paid - refundedTotal(booking));
const netCollected = (booking: Booking) =>
  Math.max(0, booking.paid - refundedTotal(booking));
function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) =>
      row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","),
    )
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const appBase = import.meta.env.BASE_URL.replace(/\/$/, "");
const publicSiteEnabled = import.meta.env.VITE_ENABLE_PUBLIC_SITE === "true";
const localPath = () => {
  const pathname = window.location.pathname;
  const withoutBase = appBase && pathname.startsWith(appBase)
    ? pathname.slice(appBase.length)
    : pathname;
  return withoutBase || "/";
};

function App() {
  const [path, setPath] = useState(localPath);
  useEffect(() => {
    const onPopState = () => setPath(localPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = (nextPath: string) => {
    window.history.pushState({}, "", `${appBase}${nextPath}` || "/");
    setPath(nextPath);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  if (path.startsWith("/manage")) {
    return <ManagementGate onNavigate={navigate} />;
  }
  if (publicSiteEnabled && path !== "/login") {
    return <PublicHome onNavigate={navigate} />;
  }
  return <LoginPage onNavigate={navigate} />;
}

function ManagementGate({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    api
      .me<{ user: StaffUser }>()
      .then((result) => setUser(result.user))
      .catch(() => onNavigate("/login"))
      .finally(() => setChecking(false));
  }, [onNavigate]);
  if (checking) return <AppLoading message="Checking secure staff session…" />;
  if (!user) return null;
  return (
    <ManagementApp
      user={user}
      onUserChange={setUser}
      onLogout={async () => {
        try {
          await api.logout();
        } finally {
          onNavigate("/login");
        }
      }}
    />
  );
}

function AppLoading({ message }: { message: string }) {
  return (
    <div className="app-loading" role="status">
      <RefreshCw className="spin" size={22} />
      <span>{message}</span>
    </div>
  );
}

function PublicHome({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [from, setFrom] = useState("Peshawar"),
    [to, setTo] = useState("Karachi"),
    [date, setDate] = useState(today),
    [searched, setSearched] = useState(false),
    [publicTrips, setPublicTrips] = useState<TripRecord[]>([]),
    [publicFleet, setPublicFleet] = useState<BusRecord[]>([]),
    [publicRoutes, setPublicRoutes] = useState<RouteRecord[]>([]),
    [occupancy, setOccupancy] = useState<PublicOccupancy[]>([]),
    [tripRuns, setTripRuns] = useState<TripRun[]>([]),
    [paymentMode, setPaymentMode] = useState("disabled"),
    [loadError, setLoadError] = useState("");
  useEffect(() => {
    api
      .publicBootstrap<PublicBootstrap>()
      .then((result) => {
        setPublicTrips(result.trips);
        setPublicFleet(result.fleet);
        setPublicRoutes(result.routes);
        setOccupancy(result.occupancy);
        setPaymentMode(result.paymentMode);
        const firstOrigin = result.routes[0]?.from;
        setFrom((currentOrigin) => {
          if (
            firstOrigin &&
            !result.routes.some((route) => route.from === currentOrigin)
          ) {
            setTo(
              result.routes.find((route) => route.from === firstOrigin)?.to ??
                "",
            );
            return firstOrigin;
          }
          return currentOrigin;
        });
      })
      .catch((error: unknown) =>
        setLoadError(error instanceof Error ? error.message : "Timetable could not be loaded."),
      );
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = () => api.publicTripRuns<TripRun>(date)
      .then((result) => { if (active) { setTripRuns(result.runs); setOccupancy(result.occupancy as PublicOccupancy[]); setPublicFleet(result.fleet as BusRecord[]); setPublicTrips(result.trips as TripRecord[]); setPublicRoutes(result.routes as RouteRecord[]); setLoadError(""); } })
      .catch(() => { if (active) setLoadError("Availability could not be refreshed. Please try again."); });
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [date]);
  const [checkoutTrip, setCheckoutTrip] = useState<{
    route: RouteRecord;
    bus: BusRecord;
    schedule: TripRecord;
    time: string;
    fare: number;
    occupiedSeats: number[];
  } | null>(null);
  const [ticketReceipt, setTicketReceipt] = useState<Booking | null>(null);
  const originCities = Array.from(
    new Set(
      publicRoutes
        .filter((route) => route.status === "Active")
        .map((route) => route.from),
    ),
  );
  const destinationCities = Array.from(
    new Set(
      publicRoutes
        .filter((route) => route.status === "Active" && route.from === from)
        .map((route) => route.to),
    ),
  );
  const matchingRoute = publicRoutes.find(
    (route) => route.from === from && route.to === to,
  );
  const travelDay = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    new Date(`${date}T00:00:00`).getDay()
  ] as Weekday;
  const departures = matchingRoute
    ? publicTrips.map((trip) => tripOnDate(trip, date, tripRuns))
        .filter(
          (schedule) =>
            schedule.routeId === matchingRoute.id &&
            schedule.active &&
            !["Departed", "Returned", "Cancelled"].includes(
              tripRuns.find((run) => run.tripId === schedule.id)?.status ?? "Scheduled",
            ) &&
            schedule.days.includes(travelDay) &&
            !["Maintenance", "Retired"].includes(publicFleet.find((bus) => bus.id === schedule.busId)?.status ?? "Retired") &&
            (date !== today ||
              schedule.departure >
                new Date().toLocaleTimeString("en-GB", {
                  timeZone: "Asia/Karachi",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })),
        )
        .map((schedule) => {
          const bus = tripBus(schedule, publicFleet);
          const occupiedSeats =
            occupancy.find(
              (item) =>
                item.tripRunId ===
                tripRunKey(schedule, schedule.runNumber, date),
            )?.seats ?? [];
          return {
            schedule,
            time: schedule.departure,
            bus,
            fare: schedule.snapshot?.route.fare ?? matchingRoute.fare,
            seats: Math.max(0, bus.seats - occupiedSeats.length),
            occupiedSeats,
          };
        })
    : [];
  const swapCities = () => {
    setFrom(to);
    setTo(from);
    setSearched(false);
  };
  return (
    <div className="public-site">
      <header className="public-nav">
        <button
          className="public-brand"
          type="button"
          onClick={() => onNavigate("/")}
        >
          <span className="brand-mark">ME</span>
          <span>
            <strong>Madina Express</strong>
            <small>Travel with confidence</small>
          </span>
        </button>
        <nav aria-label="Main navigation">
          <a href="#routes">Book a ticket</a>
          <a href="#services">Services</a>
          <a href="#contact">Contact</a>
        </nav>
      </header>
      <main className="public-main">
        <section className="public-hero">
          <div className="hero-copy">
            <p className="public-kicker">
              <span /> Intercity travel across Pakistan
            </p>
            <h1>
              Book your seat.
              <br />
              <em>Travel with confidence.</em>
            </h1>
            <p>
              Find a departure, choose your seats and reserve them online.
              Pay at the counter; online payment will be added after 1Bill setup.
            </p>
            <div className="hero-trust">
              <span>
                <BadgeCheck size={17} /> Live seat availability
              </span>
              <span>
                <ShieldCheck size={17} /> Pay at the terminal
              </span>
              <span>
                <Headphones size={17} /> Passenger support
              </span>
            </div>
          </div>
        </section>
        <section className="route-finder" id="routes">
          <div className="route-finder-heading">
            <span>
              <Route size={18} />
            </span>
            <div>
              <h2>Find your bus</h2>
              <p>Reserve online, then pay at the counter.</p>
            </div>
            <div className="payment-assurance">
              <ShieldCheck size={15} /> 1Bill payment coming soon
            </div>
          </div>
          {loadError && <p className="form-error">{loadError}</p>}
          {paymentMode === "demo" && (
            <p className="system-note">
              Payment sandbox is active. No real money is charged in this environment.
            </p>
          )}
          <form
            className="public-search"
            onSubmit={(event) => {
              event.preventDefault();
              setSearched(true);
            }}
          >
            <label>
              <span>Leaving from</span>
              <select
                value={from}
                onChange={(event) => {
                  const nextFrom = event.target.value;
                  setFrom(nextFrom);
                  const firstDestination = publicRoutes.find(
                    (route) =>
                      route.status === "Active" && route.from === nextFrom,
                  );
                  if (firstDestination) setTo(firstDestination.to);
                  setSearched(false);
                }}
              >
                {originCities.map((city) => (
                  <option key={city}>{city}</option>
                ))}
              </select>
            </label>
            <button
              className="route-direction"
              type="button"
              aria-label="Swap cities"
              onClick={swapCities}
            >
              <ArrowRight size={16} />
            </button>
            <label>
              <span>Going to</span>
              <select
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setSearched(false);
                }}
              >
                {destinationCities.map((city) => (
                  <option key={city}>{city}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Travel date</span>
              <input
                type="date"
                min={today}
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <button type="submit" className="search-journey">
              <Search size={16} /> Search buses
            </button>
          </form>
        </section>
        {searched && (
          <section className="public-results" aria-live="polite">
            <div className="results-heading">
              <div>
                <p className="eyebrow">AVAILABLE DEPARTURES</p>
                <h2>
                  {from} to {to}
                </h2>
              </div>
              <span>
                {new Date(`${date}T00:00:00`).toLocaleDateString("en-PK", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </span>
            </div>
            {matchingRoute && departures.length ? (
              departures.map((trip) => (
                <article className="public-trip" key={trip.schedule.id}>
                  <div className="trip-time">
                    <strong>{trip.time}</strong>
                    <small>{from}</small>
                  </div>
                  <div className="trip-line">
                    <span />
                    <BusFront size={19} />
                    <span />
                  </div>
                  <div className="trip-time arrival">
                    <strong>{matchingRoute.duration}</strong>
                    <small>{to}</small>
                  </div>
                  <div className="public-trip-service">
                    <strong>{trip.bus.service}</strong>
                    <small>
                      {trip.bus.registration} · {trip.seats} seats available
                    </small>
                  </div>
                  <div className="public-trip-price">
                    <small>One-way fare</small>
                    <strong>{money(trip.fare)}</strong>
                  </div>
                  <button
                    type="button"
                    disabled={trip.seats === 0}
                    onClick={() =>
                      setCheckoutTrip({
                        route: matchingRoute,
                        bus: trip.bus,
                        schedule: trip.schedule,
                        time: trip.time,
                        fare: trip.fare,
                        occupiedSeats: trip.occupiedSeats,
                      })
                    }
                  >
                    Choose seats <ArrowRight size={14} />
                  </button>
                </article>
              ))
            ) : (
              <div className="public-empty">
                <BusFront size={25} />
                <strong>No direct service found</strong>
                <span>
                  Try Peshawar as your departure city or choose another
                  destination.
                </span>
              </div>
            )}
          </section>
        )}
        <section className="public-benefits" id="services">
          <article>
            <span>
              <Navigation size={21} />
            </span>
            <div>
              <strong>Major city routes</strong>
              <p>
                Daily departures connecting Peshawar with Karachi, Lahore,
                Islamabad and Multan.
              </p>
            </div>
          </article>
          <article>
            <span>
              <Armchair size={21} />
            </span>
            <div>
              <strong>Choose your exact seat</strong>
              <p>
                See live seat availability and select up to four seats in one
                purchase.
              </p>
            </div>
          </article>
          <article>
            <span>
              <CreditCard size={21} />
            </span>
            <div>
              <strong>Pay at the terminal</strong>
              <p>
                Reserve online, then collect your paid ticket at the terminal.
              </p>
            </div>
          </article>
        </section>
      </main>
      <footer className="public-footer" id="contact">
        <div className="public-brand">
          <span className="brand-mark">ME</span>
          <span>
            <strong>Madina Express</strong>
            <small>Bus Service</small>
          </span>
        </div>
        <p>Madina Terminal, Peshawar · 0311-777-2299</p>
        <span>© 2026 Madina Express</span>
      </footer>
      {checkoutTrip && (
        <PublicCheckout
          trip={checkoutTrip}
          date={date}
          paymentMode={paymentMode}
          onClose={() => setCheckoutTrip(null)}
          onPaid={(booking) => {
            setCheckoutTrip(null);
            setTicketReceipt(booking);
          }}
        />
      )}
      {ticketReceipt && (
        <ReceiptModal
          booking={ticketReceipt}
          onClose={() => setTicketReceipt(null)}
        />
      )}
    </div>
  );
}

function PublicCheckout({
  trip,
  date,
  paymentMode,
  onClose,
  onPaid,
}: {
  trip: {
    route: RouteRecord;
    bus: BusRecord;
    schedule: TripRecord;
    time: string;
    fare: number;
    occupiedSeats: number[];
  };
  date: string;
  paymentMode: string;
  onClose: () => void;
  onPaid: (booking: Booking) => void;
}) {
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]),
    [passenger, setPassenger] = useState({
      name: "",
      phone: "",
      cnic: "",
      gender: "Male" as "Male" | "Female",
    }),
    [processing, setProcessing] = useState(false),
    [error, setError] = useState("");
  const total = selectedSeats.length * trip.fare;
  const occupied = useMemo(
    () => new Set(trip.occupiedSeats),
    [trip.occupiedSeats],
  );
  const toggleSeat = (seat: number) => {
    if (occupied.has(seat)) return;
    setSelectedSeats((current) =>
      current.includes(seat)
        ? current.filter((item) => item !== seat)
        : current.length < 4
          ? [...current, seat].sort((a, b) => a - b)
          : current,
    );
  };
  const reserveSeats = async () => {
    if (
      !selectedSeats.length ||
      !passenger.name.trim() ||
      !passenger.phone.trim() ||
      !passenger.cnic.trim()
    ) {
      setError(
        "Select a seat and enter the passenger name, mobile number and ID.",
      );
      return;
    }
    setError("");
    setProcessing(true);
    try {
      const result = await api.createPublicBooking<Booking>({
        passenger: passenger.name.trim(),
        phone: passenger.phone.trim(),
        cnic: passenger.cnic.trim(),
        gender: passenger.gender,
        boardingPoint: trip.route.boarding,
        tripId: trip.schedule.id,
        date,
        seats: selectedSeats,
      });
      onPaid(result.booking);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The reservation could not be completed.",
      );
    } finally {
      setProcessing(false);
    }
  };
  return (
    <div
      className="checkout-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Buy ticket"
    >
      <div className="checkout-modal">
        <header className="checkout-header">
          <div>
            <button type="button" onClick={onClose}>
              <ArrowLeft size={16} /> Back
            </button>
            <h2>Reserve your seats</h2>
            <p>
              {routeLabel(trip.route)} · {date} at {trip.time}
            </p>
          </div>
          <button
            className="modal-close"
            type="button"
            aria-label="Close checkout"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <div className="checkout-body">
          <section className="checkout-seat-section">
            <SectionTitle
              number="1"
              title="Select seats"
              text="Choose up to four available seats."
              suffix={String(selectedSeats.length)}
            />
            <SeatMap
              seats={trip.bus.seats}
              selectedSeats={selectedSeats}
              occupied={occupied}
              onSelect={toggleSeat}
              large
            />
          </section>
          <div className="checkout-details">
            <section className="checkout-card">
              <SectionTitle
                number="2"
                title="Passenger details"
                text="Bring the same ID when paying at the counter."
              />
              <div className="checkout-form">
                <label>
                  <span>Full name</span>
                  <input
                    value={passenger.name}
                    onChange={(event) =>
                      setPassenger({ ...passenger, name: event.target.value })
                    }
                    placeholder="Passenger full name"
                  />
                </label>
                <label>
                  <span>Mobile number</span>
                  <input
                    value={passenger.phone}
                    onChange={(event) =>
                      setPassenger({ ...passenger, phone: event.target.value })
                    }
                    placeholder="03XX XXXXXXX"
                    inputMode="tel"
                  />
                </label>
                <label>
                  <span>CNIC / Passport</span>
                  <input
                    value={passenger.cnic}
                    onChange={(event) =>
                      setPassenger({ ...passenger, cnic: event.target.value })
                    }
                    placeholder="XXXXX-XXXXXXX-X"
                  />
                </label>
                <fieldset className="compact-choice">
                  <legend>Gender</legend>
                  <div>
                    <button
                      type="button"
                      className={
                        passenger.gender === "Male" ? "choice active" : "choice"
                      }
                      onClick={() =>
                        setPassenger({ ...passenger, gender: "Male" })
                      }
                    >
                      Male
                    </button>
                    <button
                      type="button"
                      className={
                        passenger.gender === "Female"
                          ? "choice active"
                          : "choice"
                      }
                      onClick={() =>
                        setPassenger({ ...passenger, gender: "Female" })
                      }
                    >
                      Female
                    </button>
                  </div>
                </fieldset>
              </div>
            </section>
            <section className="checkout-card payment-card">
              <SectionTitle
                number="3"
                title="Confirm reservation"
                text="The terminal operator manages your reservation."
                icon
              />
              <div className="payment-total">
                <span>
                  <small>Seats</small>
                  <strong>
                    {selectedSeats.length
                      ? selectedSeats.join(", ")
                      : "None selected"}
                  </strong>
                </span>
                <span>
                  <small>Pay at counter</small>
                  <strong>{money(total)}</strong>
                </span>
              </div>
              {error && <p className="form-error">{error}</p>}
              <button
                className="pay-button"
                type="button"
                disabled={processing}
                onClick={reserveSeats}
              >
                {processing ? (
                  <>
                    <RefreshCw className="spin" size={17} /> Reserving…
                  </>
                ) : (
                  <>
                    <CalendarCheck size={17} /> Reserve seats
                  </>
                )}
              </button>
              <small className="gateway-note">
                <ShieldCheck size={13} /> No online charge. Contact the terminal if your plans change.
                {paymentMode === "disabled" && " 1Bill payment is coming soon."}
              </small>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({
  number,
  title,
  text,
  suffix,
  icon,
}: {
  number: string;
  title: string;
  text: string;
  suffix?: string;
  icon?: boolean;
}) {
  return (
    <div className="checkout-section-title">
      <span>{number}</span>
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      {suffix && <b>{suffix}</b>}
      {icon && <ShieldCheck size={20} />}
    </div>
  );
}

function LoginPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [loginNotice, setLoginNotice] = useState(""),
    [signingIn, setSigningIn] = useState(false);
  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email || !password) return;
    setSigningIn(true);
    setLoginNotice("");
    try {
      await api.login<{ user: StaffUser }>(email, password);
      onNavigate("/manage");
    } catch (error) {
      setLoginNotice(
        error instanceof ApiError
          ? error.message
          : "The server is unavailable. Please try again.",
      );
    } finally {
      setSigningIn(false);
    }
  };
  return (
    <div className="login-page">
      <div className="login-shell">

        <form className="login-form" onSubmit={signIn}>
          <div className="login-icon">
            <LockKeyhole size={20} />
          </div>
          <p className="login-business">Madina Express Operations</p>
          <h2>Welcome back</h2>
          <label>
            <span>Email or username</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your username"
              autoComplete="username"
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
            />
          </label>
          <div className="login-row">

            <button
              type="button"
              onClick={() =>
                setLoginNotice(
                  "Password reset requests are handled by the terminal administrator.",
                )
              }
            >
              Forgot password?
            </button>
          </div>
          <button className="login-submit" type="submit" disabled={signingIn}>
            {signingIn ? "Signing in…" : "Sign in to system"}{" "}
            {!signingIn && <ArrowRight size={16} />}
          </button>
          <small>Use the staff account issued by your administrator.</small>
          {loginNotice && <p className="login-notice">{loginNotice}</p>}
        </form>
      </div>
    </div>
  );
}

const navGroups = [
  {
    label: "OPERATIONS",
    items: [
      { id: "dashboard" as AdminView, label: "Today", icon: Gauge },
      { id: "sale" as AdminView, label: "Sell ticket", icon: Ticket },
      {
        id: "bookings" as AdminView,
        label: "Bookings",
        icon: BookOpenCheck,
      },
      {
        id: "reservations" as AdminView,
        label: "Reservations",
        icon: CalendarCheck,
      },
    ],
  },
  {
    label: "MANAGEMENT",
    items: [
      {
        id: "trips" as AdminView,
        label: "Roster",
        icon: CalendarDays,
      },
      { id: "fleet" as AdminView, label: "Buses", icon: Bus },
      { id: "routes" as AdminView, label: "Routes", icon: MapPinned },
      { id: "finance" as AdminView, label: "Finance", icon: Banknote },
      { id: "expenses" as AdminView, label: "Expenses", icon: ReceiptText },
      { id: "reports" as AdminView, label: "Print", icon: FileText },
      { id: "crew" as AdminView, label: "Crew", icon: UserRoundCog },
    ],
  },
];
const roleViews: Record<StaffUser["role"], AdminView[]> = {
  admin: ["dashboard", "sale", "bookings", "reservations", "trips", "fleet", "routes", "finance", "expenses", "reports", "crew", "settings"],
  manager: ["dashboard", "sale", "bookings", "reservations", "trips", "fleet", "routes", "reports", "crew", "settings"],
  counter: ["dashboard", "sale", "bookings", "reservations", "reports", "settings"],
  dispatcher: ["trips", "fleet", "reports", "crew", "settings"],
  finance: ["bookings", "reports", "settings"],
};
const defaultAdminView = (user: StaffUser): AdminView => {
  if (user.forcePasswordChange) return "settings";
  if (["admin", "manager", "counter"].includes(user.role)) return "dashboard";
  return roleViews[user.role][0];
};

function ManagementApp({
  user,
  onUserChange,
  onLogout,
}: {
  user: StaffUser;
  onUserChange: (user: StaffUser) => void;
  onLogout: () => void | Promise<void>;
}) {
  const [activeView, setActiveView] = useState<AdminView>(
      defaultAdminView(user),
    ),
    [sidebarOpen, setSidebarOpen] = useState(false),
    [sidebarCollapsed, setSidebarCollapsed] = useState(false),
    [bookings, setBookings] = useState<Booking[]>([]),
    [fleet, setFleet] = useState<BusRecord[]>([]),
    [trips, setTrips] = useState<TripRecord[]>([]),
    [runs, setRuns] = useState<TripRun[]>([]),
    [saleTarget, setSaleTarget] = useState<{ tripId: string; date: string; mode?: "Ticket" | "Reservation" } | null>(null),
    [routes, setRoutes] = useState<RouteRecord[]>([]),
    [crew, setCrew] = useState<CrewRecord[]>([]),
    [staffUsers, setStaffUsers] = useState<StaffUser[]>([]),
    [financeUnlocked, setFinanceUnlocked] = useState(false),
    [receipt, setReceipt] = useState<Booking | null>(null),
    [report, setReport] = useState<{
      kind: ReportKind;
      tripId: string;
      runNumber: number;
      date: string;
    } | null>(null),
    [toast, setToast] = useState(""),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [paymentMode, setPaymentMode] = useState("disabled");
  useEffect(() => {
    api
      .adminBootstrap<AdminBootstrap>()
      .then((result) => {
        setBookings(result.bookings);
        setFleet(result.fleet);
        setTrips(result.trips);
        setRuns(result.runs);
        setRoutes(result.routes);
        setCrew(result.crew);
        setStaffUsers(result.users);
        setPaymentMode(result.paymentMode);
        onUserChange(result.user);
      })
      .catch((error: unknown) =>
        setLoadError(error instanceof Error ? error.message : "Operations data could not be loaded."),
      )
      .finally(() => setLoading(false));
  }, [onUserChange]);
  useEffect(() => {
    const refresh = window.setInterval(() => {
      api.adminBootstrap<AdminBootstrap>()
        .then((result) => {
          setBookings(result.bookings);
          setTrips(result.trips);
          setRuns(result.runs);
          setFleet(result.fleet);
          setRoutes(result.routes);
        })
        .catch(() => undefined);
    }, 30000);
    return () => window.clearInterval(refresh);
  }, []);
  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };
  const failure = (error: unknown) =>
    showToast(error instanceof Error ? error.message : "The request failed.");
  const saveBooking = async (booking: Booking) => {
    try {
      const result = await api.createBooking<Booking>(booking);
      setBookings((current) => [result.booking, ...current]);
      setReceipt(result.booking);
      showToast(
        result.booking.bookingStatus === "Reserved"
          ? `Reservation ${result.booking.ticketNo} saved.`
          : `Paid ticket ${result.booking.ticketNo} issued.`,
      );
    } catch (error) {
      failure(error);
      throw error;
    }
  };
  const cancelBooking = async (id: string) => {
    try {
      const result = await api.cancelBooking<Booking>(id);
      setBookings((current) => current.map((item) => item.id === id ? result.booking : item));
      showToast("Booking cancelled and seats released.");
    } catch (error) {
      failure(error);
    }
  };
  const updateBooking = async (updated: Booking) => {
    try {
      const result = await api.updateBooking<Booking>(updated.id, updated);
      setBookings((current) => current.map((item) => item.id === updated.id ? result.booking : item));
      showToast(`${updated.ticketNo} passenger details updated.`);
    } catch (error) {
      failure(error);
    }
  };
  const processRefund = async (id: string, refund: RefundTransaction) => {
    try {
      const result = await api.refundBooking<Booking>(id, refund);
      setBookings((current) => current.map((item) => item.id === id ? result.booking : item));
      showToast(`${money(refund.amount)} refund recorded with an audit trail.`);
    } catch (error) {
      failure(error);
      throw error;
    }
  };
  const confirmReservation = async (id: string, method: PaymentMethod, reference: string) => {
    try {
      const result = await api.confirmReservation<Booking>(id, method, reference);
      setBookings((current) => current.map((item) => item.id === id ? result.booking : item));
      setReceipt(result.booking);
      showToast("Payment collected. Confirmed ticket issued.");
    } catch (error) {
      failure(error);
      throw error;
    }
  };
  const changeView = (view: AdminView) => {
    if (!roleViews[user.role].includes(view)) return;
    setActiveView(view);
    setSidebarOpen(false);
    window.scrollTo({ top: 0 });
  };
  const saveBus = async (bus: BusRecord) => {
    try {
      const isNew = !fleet.some((item) => item.id === bus.id);
      const result = await api.saveBus<BusRecord>(bus.id, bus, isNew);
      setFleet((current) => isNew ? [result.bus, ...current] : current.map((item) => item.id === bus.id ? result.bus : item));
      showToast(`Bus ${result.bus.registration} saved.`);
    } catch (error) {
      failure(error);
    }
  };
  const deleteBus = async (id: string) => {
    try {
      const bus = fleet.find((item) => item.id === id);
      await api.deleteBus(id);
      setFleet((current) => current.filter((item) => item.id !== id));
      showToast(`${bus?.registration ?? "Bus"} deleted.`);
    } catch (error) {
      failure(error);
      throw error;
    }
  };
  const saveTrip = async (trip: TripRecord) => {
    try {
      const isNew = !trips.some((item) => item.id === trip.id);
      const result = await api.saveTrip<TripRecord>(trip.id, trip, isNew);
      setTrips((current) => isNew ? [result.trip, ...current] : current.map((item) => item.id === trip.id ? result.trip : item));
      showToast("Recurring trip saved.");
    } catch (error) {
      failure(error);
      throw error;
    }
  };
  const deleteTrip = async (id: string) => {
    try {
      await api.deleteTrip(id);
      setTrips((current) => current.filter((item) => item.id !== id));
      showToast("Trip deleted.");
    } catch (error) {
      failure(error);
      throw error;
    }
  };
  const saveRoute = async (route: RouteRecord) => {
    try {
      const isNew = !routes.some((item) => item.id === route.id);
      const result = await api.saveRoute<RouteRecord>(route.id, route, isNew);
      setRoutes((current) => isNew ? [result.route, ...current] : current.map((item) => item.id === route.id ? result.route : item));
      showToast(`${routeLabel(result.route)} saved.`);
    } catch (error) {
      failure(error);
    }
  };
  const deleteRoute = async (id: string) => {
    try {
      const route = routes.find((item) => item.id === id);
      await api.deleteRoute(id);
      setRoutes((current) => current.filter((item) => item.id !== id));
      showToast(`${route ? routeLabel(route) : "Route"} deleted.`);
    } catch (error) {
      failure(error);
      throw error;
    }
  };
  const saveCrewMember = async (person: CrewRecord, previousName?: string) => {
    try {
      const result = await api.saveCrew<CrewRecord>(previousName, person);
      setCrew((current) => previousName ? current.map((item) => item.name === previousName ? result.person : item) : [result.person, ...current]);
      showToast(`${result.person.name} saved.`);
    } catch (error) {
      failure(error);
    }
  };
  const deleteCrewMember = async (id: number) => {
    try {
      const person = crew.find((item) => item.id === id);
      await api.deleteCrew(id);
      setCrew((current) => current.filter((item) => item.id !== id));
      showToast(`${person?.name ?? "Staff member"} deleted.`);
    } catch (error) {
      failure(error);
      throw error;
    }
  };
  const transitionTrip = async (id: string, action: "boarding" | "depart" | "return", date: string, notes = "") => {
    try {
      const result = await api.transitionTrip<TripRun>(id, action, date, notes);
      setRuns((current) => [...current.filter((run) => run.id !== result.trip.id), result.trip]);
      const fresh = await api.adminBootstrap<AdminBootstrap>();
      setTrips(fresh.trips); setFleet(fresh.fleet); setRuns(fresh.runs);
      showToast(action === "return" ? "Return recorded. The bus is ready." : action === "depart" ? "Departure recorded." : "Boarding started.");
    } catch (error) { failure(error); throw error; }
  };
  const startSale = (tripId: string, date: string) => {
    setSaleTarget({ tripId, date }); changeView("sale");
  };
  const openReport = (
    kind: ReportKind,
    tripId: string,
    runNumber: number,
    date = today,
  ) => setReport({ kind, tripId, runNumber, date });
  const reservationCount = bookings.filter(
      (booking) => booking.bookingStatus === "Reserved",
    ).length,
    paidCount = bookings.filter(
      (booking) =>
        booking.bookingStatus === "Confirmed" &&
        booking.paid > 0,
    ).length;
  if (loading) return <AppLoading message="Loading transport operations…" />;
  if (loadError) {
    return (
      <div className="app-loading" role="alert">
        <XCircle size={22} />
        <span>{loadError}</span>
        <button type="button" className="secondary-button" onClick={onLogout}>
          Return to sign in
        </button>
      </div>
    );
  }
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const visibleNavGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => roleViews[user.role].includes(item.id)),
    }))
    .filter((group) => group.items.length > 0);
  return (
    <div
      className={`admin-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
    >
      <button
        className={`sidebar-scrim ${sidebarOpen ? "show" : ""}`}
        type="button"
        aria-label="Close menu"
        onClick={() => setSidebarOpen(false)}
      />
      <aside
        className={`admin-sidebar ${sidebarOpen ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`}
      >
        <div className="sidebar-brand">
          <div>
            <strong>Madina Express</strong>
            <small>Operations Suite</small>
          </div>
          <button
            className="sidebar-collapse"
            type="button"
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
        </div>
        <nav aria-label="Operations modules">
          {visibleNavGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const count =
                  item.id === "bookings"
                    ? paidCount
                    : item.id === "reservations"
                      ? reservationCount
                      : 0;
                return (
                  <button
                    type="button"
                    title={sidebarCollapsed ? item.label : undefined}
                    className={activeView === item.id ? "active" : ""}
                    onClick={() => changeView(item.id)}
                    key={item.id}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                    {count > 0 && <b>{count}</b>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            type="button"
            title={sidebarCollapsed ? "Settings" : undefined}
            className={activeView === "settings" ? "active" : ""}
            onClick={() => changeView("settings")}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
          <small>
            Madina Terminal
            <br />
            Peshawar
          </small>
        </div>
      </aside>
      <div className="admin-content">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <button
              className="mobile-menu"
              type="button"
              aria-label="Open menu"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={19} />
            </button>
            <div className="admin-page-title">
              <strong>Madina Express</strong>
            </div>
          </div>
          <div className="admin-topbar-right">
            <div className="admin-user">
              <span className="avatar">{initials}</span>
              <div>
                <strong>{user.name}</strong>
                <small>{user.role} · Counter 01</small>
              </div>
            </div>
            <button
              className="admin-signout"
              type="button"
              title="Sign out"
              aria-label="Sign out"
              onClick={onLogout}
            >
              <LogOut size={15} />
            </button>
          </div>
        </header>
        <main className="admin-main">
          {activeView === "dashboard" && (
            <DashboardView
              bookings={bookings}
              trips={tripsOnDate(trips, today, runs)}
              fleet={fleet}
              routes={routes}
              onNavigate={changeView}
              userName={user.name}
            />
          )}
          {activeView === "sale" && (!trips.length || !routes.length || !fleet.length ? <EmptyState title="Add a schedule first" text="Create a route, bus and roster entry before selling tickets." /> : (
            <BookingWorkspace
              key={saleTarget ? `${saleTarget.tripId}-${saleTarget.date}-${saleTarget.mode}` : "sale"}
              initialSelection={saleTarget}
              runs={runs}
              bookings={bookings}
              trips={trips}
              fleet={fleet}
              routes={routes}
              onSave={saveBooking}
              showToast={showToast}
              paymentMode={paymentMode}
            />
          ))}
          {activeView === "bookings" && (
            <BookingsView
              bookings={bookings}
              onPrint={setReceipt}
              onUpdate={updateBooking}
              onRefund={processRefund}
              canEdit={["admin", "manager", "counter"].includes(user.role)}
              canRefund={["admin", "manager", "finance"].includes(user.role)}
            />
          )}
          {activeView === "reservations" && (
            <ReservationsView
              bookings={bookings}
              onConfirm={confirmReservation}
              onCancel={cancelBooking}
              onNew={() => { setSaleTarget({ tripId: trips[0]?.id ?? "", date: today, mode: "Reservation" }); changeView("sale"); }}
              paymentMode={paymentMode}
            />
          )}
          {activeView === "trips" && (
            <TripsView
              runs={runs}
              onSell={startSale}
              bookings={bookings}
              trips={trips}
              fleet={fleet}
              routes={routes}
              crew={crew}
              onSave={saveTrip}
              onDelete={deleteTrip}
              onTransition={transitionTrip}
              onReport={openReport}
            />
          )}
          {activeView === "fleet" && (
            <FleetView
              fleet={fleet}
              onSave={saveBus}
              onDelete={deleteBus}
            />
          )}
          {activeView === "routes" && (
            <RoutesView routes={routes} onSave={saveRoute} onDelete={deleteRoute} />
          )}
          {activeView === "finance" && (
            <FinanceProtected
              unlocked={financeUnlocked}
              onUnlocked={() => setFinanceUnlocked(true)}
            >
              <FinanceView bookings={bookings} />
            </FinanceProtected>
          )}
          {activeView === "expenses" && (
            <FinanceProtected
              unlocked={financeUnlocked}
              onUnlocked={() => setFinanceUnlocked(true)}
            >
              <ExpensesView showToast={showToast} />
            </FinanceProtected>
          )}
          {activeView === "reports" && (
            <ReportsView
              runs={runs}
              onSell={["admin", "manager", "counter"].includes(user.role) ? startSale : undefined}
              onPrintTicket={setReceipt}
              bookings={bookings}
              trips={trips}
              fleet={fleet}
              routes={routes}
              onReport={openReport}
            />
          )}
          {activeView === "crew" && (
            <CrewView crew={crew} onSave={saveCrewMember} onDelete={deleteCrewMember} />
          )}
          {activeView === "settings" && (
            <SettingsView
              user={user}
              onUserChange={onUserChange}
              paymentMode={paymentMode}
              staffUsers={staffUsers}
              onUserCreated={(created) =>
                setStaffUsers((current) => [created, ...current])
              }
              showToast={showToast}
            />
          )}
        </main>
      </div>
      {receipt && (
        <ReceiptModal booking={receipt} onClose={() => setReceipt(null)} />
      )}
      {report && (
        <ReportModal
          runs={runs}
          preparedBy={user.name}
          report={report}
          bookings={bookings}
          trips={trips}
          fleet={fleet}
          routes={routes}
          onClose={() => setReport(null)}
        />
      )}
      {toast && (
        <div className="toast">
          <Check size={16} /> {toast}
        </div>
      )}
    </div>
  );
}

function DashboardView({
  bookings,
  trips,
  fleet,
  routes,
  onNavigate,
  userName,
}: {
  bookings: Booking[];
  trips: TripRecord[];
  fleet: BusRecord[];
  routes: RouteRecord[];
  onNavigate: (view: AdminView) => void;
  userName: string;
}) {
  const [revenuePeriod, setRevenuePeriod] = useState<"Today" | "Week">("Today");
  const settled = bookings.filter((booking) => booking.paid > 0);
  const paid = settled.filter(
    (booking) => booking.bookingStatus === "Confirmed",
  );
  const inLastDays = (date: string, days: number) => {
    const difference =
      new Date(`${today}T00:00:00`).getTime() -
      new Date(`${date}T00:00:00`).getTime();
    return difference >= 0 && difference < days * 86400000;
  };
  const collectionForDays = (days: number, source?: BookingSource) => {
    const gross = settled
      .filter(
        (booking) =>
          inLastDays(booking.date, days) &&
          (!source || booking.source === source),
      )
      .reduce((sum, booking) => sum + booking.paid, 0);
    const refunds = settled
      .filter((booking) => !source || booking.source === source)
      .flatMap((booking) => booking.refunds ?? [])
      .filter((refund) => inLastDays(dateInPakistan(refund.processedAt), days))
      .reduce((sum, refund) => sum + refund.amount, 0);
    return Math.max(0, gross - refunds);
  };
  const periodDays = revenuePeriod === "Today" ? 1 : 7;
  const displayedRevenue = collectionForDays(periodDays);
  const displayedWebSales = collectionForDays(periodDays, "Public web");
  const todayPaidSeats = paid
    .filter((booking) => booking.date === today)
    .reduce((sum, booking) => sum + booking.seats.length, 0);
  const reservations = bookings.filter(
    (booking) => booking.bookingStatus === "Reserved",
  );
  const todayDay = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${today}T00:00:00`).getDay()] as Weekday;
  const pakistanHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: "Asia/Karachi",
    }).format(new Date()),
  );
  const greeting =
    pakistanHour < 12 ? "morning" : pakistanHour < 17 ? "afternoon" : "evening";
  const dateHeading = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "Asia/Karachi",
  })
    .format(new Date())
    .toUpperCase();
  const metrics = [
    {
      label: "Today's tickets",
      value: todayPaidSeats.toLocaleString("en-PK"),
      note: "Confirmed passenger seats",
      icon: Ticket,
      tone: "green",
    },
    {
      label: "Active reservations",
      value: String(reservations.length),
      note: "Waiting for payment",
      icon: CalendarCheck,
      tone: "blue",
    },
    {
      label: "Scheduled trips",
      value: String(trips.filter((trip) => trip.active && !["Departed", "Returned", "Cancelled"].includes(trip.status)).length),
      note: "Upcoming departures",
      icon: BusFront,
      tone: "gold",
    },
    {
      label: "Buses ready",
      value: String(fleet.filter((bus) => bus.status === "Ready").length),
      note: `${fleet.filter((bus) => bus.status === "Maintenance").length} in maintenance`,
      icon: Bus,
      tone: "orange",
    },
  ];
  const showDashboardFinance = false;
  return (
    <div className="admin-view dashboard-view">
      <ViewHeading
        eyebrow={dateHeading}
        title={`Good ${greeting}, ${userName.split(" ")[0]}`}
        text="Here is what is happening across Madina Express today."
        action={
          <button
            className="primary-button"
            type="button"
            onClick={() => onNavigate("sale")}
          >
            <Plus size={16} /> New sale
          </button>
        }
      />
      <section className="metric-grid">
        {metrics.map((m) => {
          const Icon = m.icon;
          return (
            <article className="metric-card" key={m.label}>
              <span className={`metric-icon ${m.tone}`}>
                <Icon size={19} />
              </span>
              <div>
                <small>{m.label}</small>
                <strong>{m.value}</strong>
                <p>{m.note}</p>
              </div>
            </article>
          );
        })}
      </section>
      <div className="dashboard-grid">
        <section className="surface schedule-panel">
          <SurfaceHeader
            title="Today’s departures"
            text="Live trip and boarding status"
            action={
              <button type="button" onClick={() => onNavigate("trips")}>
                View schedule <ChevronRight size={15} />
              </button>
            }
          />
          <div className="schedule-list">
            {trips
              .filter((trip) => trip.active && trip.days.includes(todayDay) && !["Departed", "Returned", "Cancelled"].includes(trip.status))
              .map((t) => {
                const r = routes.find((x) => x.id === t.routeId) ?? routes[0],
                  bus = fleet.find((x) => x.id === t.busId) ?? fleet[0],
                  sold = bookingsForTripRun(bookings, t, bus).flatMap(
                    (booking) => booking.seats,
                  ).length;
                return (
                  <article key={t.id}>
                    <time>{t.departure}</time>
                    <span
                      className={`timeline-dot ${t.status.toLowerCase()}`}
                    />
                    <div className="schedule-route">
                      <strong>{routeLabel(r)}</strong>
                      <small>
                        {bus.registration} · {bus.service}
                      </small>
                    </div>
                    <div className="schedule-load">
                      <span>
                        <i
                          style={{
                            width: `${Math.min(100, Math.round((sold / bus.seats) * 100))}%`,
                          }}
                        />
                      </span>
                      <small>
                        {sold}/{bus.seats} seats
                      </small>
                    </div>
                    <b className={`plain-status ${t.status.toLowerCase()}`}>
                      {t.status}
                    </b>
                  </article>
                );
              })}
          </div>
        </section>
        {showDashboardFinance && <section className="surface revenue-panel">
          <SurfaceHeader
            title="Revenue overview"
            text="Collections by sales channel"
            action={
              <div className="mini-tabs">
                {(["Week", "Today"] as const).map((item) => (
                  <button
                    type="button"
                    className={revenuePeriod === item ? "active" : ""}
                    onClick={() => setRevenuePeriod(item)}
                    key={item}
                  >
                    {item}
                  </button>
                ))}
              </div>
            }
          />
          <div className="revenue-total">
            <small>Net collected</small>
            <strong>{money(displayedRevenue)}</strong>
            <span>
              <Activity size={13} /> After refunds
            </span>
          </div>
          <div className="channel-bars">
            <ProgressRow
              label="Counter sales"
              value={money(displayedRevenue - displayedWebSales)}
              percent={
                displayedRevenue
                  ? Math.round(
                      ((displayedRevenue - displayedWebSales) /
                        displayedRevenue) *
                        100,
                    )
                  : 0
              }
            />
            <ProgressRow
              label="Public website · 1Bill"
              value={money(displayedWebSales)}
              percent={
                displayedRevenue
                  ? Math.round((displayedWebSales / displayedRevenue) * 100)
                  : 0
              }
              gold
            />
          </div>
          <SettlementNote
            title="Refund-aware totals"
            text="Gross payments less recorded refunds for this period."
          />
        </section>}
      </div>
      <section className="surface recent-panel">
        <SurfaceHeader
          title="Reservations to collect"
          text={`${reservations.length} unpaid hold${reservations.length === 1 ? "" : "s"}`}
          action={
            <button type="button" onClick={() => onNavigate("reservations")}>
              Open reservations <ChevronRight size={15} />
            </button>
          }
        />
        {reservations.length ? (
          <BookingTable bookings={reservations.slice(0, 5)} onPrint={() => undefined} compact />
        ) : (
          <EmptyState title="No payment waiting" text="New online and counter reservations will appear here automatically." />
        )}
      </section>
      {showDashboardFinance && <section className="surface recent-panel">
        <SurfaceHeader
          title="Recent sales activity"
          text="Latest paid tickets from web and counter"
          action={
            <button type="button" onClick={() => onNavigate("bookings")}>
              All bookings <ChevronRight size={15} />
            </button>
          }
        />
        <BookingTable
          bookings={paid.slice(0, 5)}
          onPrint={() => undefined}
          compact
        />
      </section>}
    </div>
  );
}

function ViewHeading({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="view-heading">
      <div>
        <p className="view-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
function SurfaceHeader({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="surface-header">
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
function ProgressRow({
  label,
  value,
  percent,
  gold = false,
}: {
  label: string;
  value: string;
  percent: number;
  gold?: boolean;
}) {
  return (
    <div>
      <span>
        <b>{label}</b>
        <small>{value}</small>
      </span>
      <i>
        <em className={gold ? "gold" : ""} style={{ width: `${percent}%` }} />
      </i>
    </div>
  );
}
function SettlementNote({ title, text }: { title: string; text: string }) {
  return (
    <div className="settlement-note">
      <CheckCircle2 size={17} />
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
    </div>
  );
}

function BookingWorkspace({
  bookings,
  trips,
  fleet,
  routes,
  runs,
  initialSelection,
  onSave,
  showToast,
  paymentMode,
}: {
  bookings: Booking[];
  trips: TripRecord[];
  fleet: BusRecord[];
  routes: RouteRecord[];
  runs: TripRun[];
  initialSelection: { tripId: string; date: string; mode?: "Ticket" | "Reservation" } | null;
  onSave: (booking: Booking) => Promise<void>;
  showToast: (message: string) => void;
  paymentMode: string;
}) {
  const defaultTrip = trips.find((trip) => trip.id === initialSelection?.tripId) ?? trips.find((trip) => trip.active) ?? trips[0];
  const [saleMode, setSaleMode] = useState<"Ticket" | "Reservation">(initialSelection?.mode ?? "Ticket"),
    [selectedTripId, setSelectedTripId] = useState(defaultTrip.id),
    [travelDate, setTravelDate] = useState(initialSelection?.date ?? today),
    [selectedSeats, setSelectedSeats] = useState<number[]>([]),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState("");
  const activeTrip = tripOnDate(trips.find((trip) => trip.id === selectedTripId) ?? defaultTrip, travelDate, runs);
  const route = tripRoute(activeTrip, routes), bus = tripBus(activeTrip, fleet);
  const departureTime = activeTrip.departure, driver = activeTrip.driver, attendant = activeTrip.attendant;
  const currentRunId = tripRunKey(activeTrip, activeTrip.runNumber, travelDate);
  const unavailable = !activeTrip.active || !activeTrip.days.includes(serviceDayFor(travelDate)) ||
    ["Departed","Returned","Cancelled"].includes(activeTrip.status) ||
    ["Maintenance","Retired"].includes(fleet.find((item) => item.id === activeTrip.busId)?.status ?? "Retired");
  const [passenger, setPassenger] = useState<PassengerForm>({
    passenger: "",
    phone: "",
    cnic: "",
    idType: "CNIC",
    gender: "Male",
    boardingPoint: route.boarding,
    fare: route.fare,
    discount: 0,
    paymentMethod: "Cash",
    paymentReference: "",
  });
  const total = Math.max(
      0,
      Number(route.fare) * selectedSeats.length - passenger.discount,
    ),
    occupied = useMemo(
      () =>
        new Set(
          bookings
            .filter(
              (b) =>
                b.bus === bus.registration &&
                b.date === travelDate &&
                b.time === departureTime &&
                (b.tripRunId
                  ? b.tripRunId === currentRunId
                  : activeTrip.runNumber === 1) &&
                ["Confirmed", "Reserved"].includes(b.bookingStatus),
            )
            .flatMap((b) => b.seats),
        ),
      [
        bookings,
        bus.registration,
        departureTime,
        travelDate,
        currentRunId,
        activeTrip.runNumber,
      ],
    );
  const update = <K extends keyof PassengerForm>(
    key: K,
    value: PassengerForm[K],
  ) => setPassenger((current) => ({ ...current, [key]: value }));
  const reset = () => {
    setPassenger({
      passenger: "",
      phone: "",
      cnic: "",
      idType: "CNIC",
      gender: "Male",
      boardingPoint: route.boarding,
      fare: route.fare,
      discount: 0,
      paymentMethod: "Cash",
      paymentReference: "",
    });
    setSelectedSeats([]);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    if (saving) return;
    setSaveError("");
    event.preventDefault();
    if (
      !passenger.passenger.trim() ||
      !passenger.phone.trim() ||
      !passenger.cnic.trim()
    )
      return showToast("Complete the passenger name, mobile number and ID.");
    if (!selectedSeats.length)
      return showToast("Select at least one available seat.");
    if (
      saleMode === "Ticket" &&
      passenger.paymentMethod !== "Cash" &&
      !passenger.paymentReference.trim()
    )
      return showToast("Enter the verified payment reference.");
    const stamp = Date.now(),
      reserved = saleMode === "Reservation";
    setSaving(true);
    try { await onSave({
      id: String(stamp),
      ticketNo: `${reserved ? "RS" : "ME"}-${travelDate.slice(2).replaceAll("-", "")}-${String(stamp).slice(-4)}`,
      source: "Counter",
      passenger: passenger.passenger.trim(),
      phone: passenger.phone.trim(),
      cnic: passenger.cnic.trim(),
      gender: passenger.gender,
      route: routeLabel(route),
      destination: route.to,
      boardingPoint: passenger.boardingPoint,
      bus: bus.registration,
      service: bus.service,
      seats: selectedSeats,
      fare: Number(route.fare),
      discount: passenger.discount,
      total,
      paid: reserved ? 0 : total,
      balance: reserved ? total : 0,
      paymentMethod: passenger.paymentMethod,
      paymentReference: reserved
        ? ""
        : passenger.paymentReference || `CASH-${String(stamp).slice(-6)}`,
      paymentStatus: reserved ? "Unpaid" : "Paid",
      bookingStatus: reserved ? "Reserved" : "Confirmed",
      date: travelDate,
      time: departureTime,
      driver,
      attendant,
      createdAt: new Date().toISOString(),
      tripId: activeTrip.id,
      tripRunId: currentRunId,
      seatPrintedAt: new Date().toISOString(),
      issuedBy: undefined,
      terminal: "Madina Terminal, Peshawar",

    });
    reset();
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Ticket was not saved. Your entries have been kept."); }
    finally { setSaving(false); }
  };
  return (
    <div className="admin-view sale-view">
      <div className="booking-surface">
        <section className="trip-panel admin-trip-panel">
          <div className="panel-heading">
            <h2>Trip and crew</h2>
            <div className="trip-status">
              <BusFront size={16} /> {bus.seats - occupied.size} seats available
            </div>
          </div>
          <div className="trip-grid">
            <label className="wide-field">
              <span>
                <MapPin size={13} /> Scheduled trip
              </span>
              <select
                value={selectedTripId}
                onChange={(e) => {
                  const next =
                    trips.find((trip) => trip.id === e.target.value) ??
                    defaultTrip;
                  const r =
                    routes.find((item) => item.id === next.routeId) ??
                    routes[0];
                  setSelectedTripId(next.id);
                  setSelectedSeats([]);
                  setPassenger((p) => ({
                    ...p,
                    boardingPoint: r.boarding,
                    fare: r.fare,
                  }));
                }}
              >
                {trips
                  .filter((trip) => trip.active)
                  .map((trip) => {
                    const tripRoute =
                      routes.find((item) => item.id === trip.routeId) ??
                      routes[0];
                    return (
                      <option value={trip.id} key={trip.id}>
                        {trip.departure} · {routeLabel(tripRoute)} ·{" "}
                        {trip.days.join(" ")}
                      </option>
                    );
                  })}
              </select>
            </label>
            <label>
              <span>
                <BusFront size={13} /> Bus
              </span>
              <input value={`${bus.registration} · ${bus.service}`} readOnly />
            </label>
            <label>
              <span>
                <CalendarDays size={13} /> Travel date
              </span>
              <input
                type="date"
                min={today}
                value={travelDate}
                onChange={(e) => { setTravelDate(e.target.value); setSelectedSeats([]); }}
              />
            </label>
            <label>
              <span>
                <Clock3 size={13} /> Departure
              </span>
              <input
                type="time"
                value={departureTime}
                readOnly
              />
            </label>
            <label>
              <span>
                <UserRound size={13} /> Driver
              </span>
              <input value={driver} readOnly />
            </label>
            <label>
              <span>
                <UsersRound size={13} /> Female attendant
              </span>
              <input value={attendant} readOnly />
            </label>
          </div>
          <div className="trip-summary-bar">
            <span>
              <small>Service</small>
              <strong>{bus.service}</strong>
            </span>
            <span>
              <small>Vehicle</small>
              <strong>{bus.registration}</strong>
            </span>
            <span>
              <small>Occupied</small>
              <strong>
                {occupied.size} / {bus.seats}
              </strong>
            </span>
            <span>
              <small>Departure</small>
              <strong>{departureTime}</strong>
            </span>
          </div>
        </section>
        <div className="sale-toolbar">
          <div className="mode-tabs" aria-label="Sale type">
            <button
              type="button"
              className={saleMode === "Ticket" ? "active" : ""}
              onClick={() => setSaleMode("Ticket")}
            >
              <Ticket size={16} /> Paid ticket
            </button>
            <button
              type="button"
              className={saleMode === "Reservation" ? "active" : ""}
              onClick={() => setSaleMode("Reservation")}
            >
              <CalendarCheck size={16} /> Reservation
            </button>
          </div>
        </div>
        <form className="workspace-grid admin-booking-grid" onSubmit={submit}>
          <section className="passenger-card">
            <div className="panel-heading">
              <h2>Passenger</h2>
              <ShieldCheck size={20} />
            </div>
            <div className="form-grid">
              <label className="span-2">
                <span>Passenger name *</span>
                <input
                  value={passenger.passenger}
                  onChange={(e) => update("passenger", e.target.value)}
                  placeholder="Enter full name"
                />
              </label>
              <label>
                <span>Mobile number *</span>
                <input
                  value={passenger.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  placeholder="03XX XXXXXXX"
                />
              </label>
              <fieldset className="compact-choice">
                <legend>Gender</legend>
                <div>
                  <button
                    type="button"
                    className={
                      passenger.gender === "Male" ? "choice active" : "choice"
                    }
                    onClick={() => update("gender", "Male")}
                  >
                    Male
                  </button>
                  <button
                    type="button"
                    className={
                      passenger.gender === "Female" ? "choice active" : "choice"
                    }
                    onClick={() => update("gender", "Female")}
                  >
                    Female
                  </button>
                </div>
              </fieldset>
              <fieldset className="compact-choice">
                <legend>ID type</legend>
                <div>
                  <button
                    type="button"
                    className={
                      passenger.idType === "CNIC" ? "choice active" : "choice"
                    }
                    onClick={() => update("idType", "CNIC")}
                  >
                    CNIC
                  </button>
                  <button
                    type="button"
                    className={
                      passenger.idType === "Passport"
                        ? "choice active"
                        : "choice"
                    }
                    onClick={() => update("idType", "Passport")}
                  >
                    Passport
                  </button>
                </div>
              </fieldset>
              <label>
                <span>{passenger.idType} number *</span>
                <input
                  value={passenger.cnic}
                  onChange={(e) => update("cnic", e.target.value)}
                  placeholder="XXXXX-XXXXXXX-X"
                />
              </label>
              <label className="span-2">
                <span>Boarding / pickup point</span>
                <input
                  value={passenger.boardingPoint}
                  onChange={(e) => update("boardingPoint", e.target.value)}
                />
              </label>
            </div>
            <h3 className="simple-form-heading">{saleMode === "Ticket" ? "Payment" : "Fare"}</h3>
            <div className="form-grid fare-grid">
              <MoneyField
                label="Fare per seat"
                value={Number(route.fare)}
                readOnly
              />
              <MoneyField
                label="Discount"
                value={passenger.discount}
                onChange={(v) => update("discount", v)}
              />
              <MoneyField label="Total due" value={total} readOnly />
            </div>
            {saleMode === "Ticket" && (
              <>
                <fieldset className="payment-methods">
                  <legend>Full payment method</legend>
                  <div>
                    {(
                      [
                        "Cash",
                        "Card",
                        "Bank transfer",
                        "1Bill",
                      ] as PaymentMethod[]
                    ).map((method) => (
                      <button
                        type="button"
                        key={method}
                        disabled={method === "1Bill" && paymentMode === "disabled"}
                        title={method === "1Bill" && paymentMode === "disabled" ? "Available after 1Bill activation" : undefined}
                        className={
                          passenger.paymentMethod === method
                            ? "payment-method active"
                            : "payment-method"
                        }
                        onClick={() => update("paymentMethod", method)}
                      >
                        {method === "Cash" ? (
                          <WalletCards size={15} />
                        ) : (
                          <CreditCard size={15} />
                        )}
                        {method}{method === "1Bill" && paymentMode === "disabled" ? " · soon" : ""}
                      </button>
                    ))}
                  </div>
                </fieldset>
                {passenger.paymentMethod !== "Cash" && (
                  <label className="reference-field">
                    <span>Payment reference *</span>
                    <input
                      value={passenger.paymentReference}
                      onChange={(e) =>
                        update("paymentReference", e.target.value)
                      }
                      placeholder="Verified transaction reference"
                    />
                  </label>
                )}
              </>
            )}
            <div
              className={`payment-summary ${saleMode === "Reservation" ? "reservation-summary" : ""}`}
            >
              <span>
                <small>
                  {selectedSeats.length} seat
                  {selectedSeats.length === 1 ? "" : "s"} ×{" "}
                  {money(Number(route.fare))}
                </small>
                <strong>
                  {saleMode === "Ticket"
                    ? "Fully paid total"
                    : "Pay at counter"}
                </strong>
              </span>
              <b>{money(total)}</b>
              <span className="balance">
                <small>Status</small>
                <strong>
                  {saleMode === "Ticket"
                    ? "Paid on issue"
                    : "Unpaid reservation"}
                </strong>
              </span>
            </div>
            {unavailable && <p className="form-error">This departure is unavailable. Select another date or check the roster.</p>}
            {saveError && <p className="form-error">{saveError}</p>}
            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={reset}
              >
                <RefreshCw size={15} /> Clear
              </button>
              <button type="submit" className="primary-button" disabled={saving || unavailable}>
                {saleMode === "Ticket" ? (
                  <>
                    <ReceiptText size={17} /> Collect & issue ticket
                  </>
                ) : (
                  <>
                    <CalendarCheck size={17} /> Reserve seats
                  </>
                )}
              </button>
            </div>
          </section>
          <section className="seat-card">
            <div className="panel-heading">
              <div>
                <h2>Select seats</h2>
                <p>
                  {selectedSeats.length
                    ? `Seats ${selectedSeats.join(", ")} selected`
                    : "Choose one or more available seats"}
                </p>
              </div>
              <div className="seat-count">{selectedSeats.length}</div>
            </div>
            <SeatMap
              seats={bus.seats}
              selectedSeats={selectedSeats}
              occupied={occupied}
              onSelect={(seat) =>
                setSelectedSeats((current) =>
                  current.includes(seat)
                    ? current.filter((x) => x !== seat)
                    : [...current, seat].sort((a, b) => a - b),
                )
              }
              large
            />
            <div className="seat-card-footer">
              <span>
                <Armchair size={15} /> {bus.seats - occupied.size} available
              </span>
              <strong>{money(total)}</strong>
            </div>
          </section>
        </form>
      </div>
    </div>
  );
}

function MoneyField({
  label,
  value,
  onChange,
  readOnly = false,
}: {
  label: string;
  value: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
}) {
  return (
    <label>
      <span>{label}</span>
      <div className="money-input">
        <b>PKR</b>
        <input
          type="number"
          min="0"
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange?.(Number(e.target.value))}
        />
      </div>
    </label>
  );
}

function BookingEditModal({
  booking,
  onClose,
  onSave,
}: {
  booking: Booking;
  onClose: () => void;
  onSave: (booking: Booking) => void;
}) {
  const [draft, setDraft] = useState(booking);
  return (
    <div
      className="form-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${booking.ticketNo}`}
    >
      <form
        className="form-modal compact-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <header>
          <div>
            <h2>Edit passenger details</h2>
            <p>
              {booking.ticketNo} · {booking.route} · Seats{" "}
              {booking.seats.join(", ")}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <div className="modal-form-grid">
          <label className="span-2">
            <span>Passenger name *</span>
            <input
              required
              value={draft.passenger}
              onChange={(event) =>
                setDraft({ ...draft, passenger: event.target.value })
              }
            />
          </label>
          <label>
            <span>Mobile number *</span>
            <input
              required
              value={draft.phone}
              onChange={(event) =>
                setDraft({ ...draft, phone: event.target.value })
              }
            />
          </label>
          <label>
            <span>CNIC / Passport *</span>
            <input
              required
              value={draft.cnic}
              onChange={(event) =>
                setDraft({ ...draft, cnic: event.target.value })
              }
            />
          </label>
          <label>
            <span>Gender</span>
            <select
              value={draft.gender}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  gender: event.target.value as Booking["gender"],
                })
              }
            >
              <option>Male</option>
              <option>Female</option>
            </select>
          </label>
          <label>
            <span>Destination</span>
            <input
              value={draft.destination}
              onChange={(event) =>
                setDraft({ ...draft, destination: event.target.value })
              }
            />
          </label>
          <label className="span-2">
            <span>Boarding / pickup point</span>
            <input
              value={draft.boardingPoint}
              onChange={(event) =>
                setDraft({ ...draft, boardingPoint: event.target.value })
              }
            />
          </label>
        </div>
        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            <Check size={16} /> Save changes
          </button>
        </footer>
      </form>
    </div>
  );
}

function RefundModal({
  booking,
  onClose,
  onRefund,
}: {
  booking: Booking;
  onClose: () => void;
  onRefund: (id: string, refund: RefundTransaction) => Promise<void>;
}) {
  const available = refundableBalance(booking);
  const [amount, setAmount] = useState(available);
  const [method, setMethod] = useState<PaymentMethod>(booking.paymentMethod);
  const [reason, setReason] = useState<RefundReason>("Passenger request");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [releaseSeats, setReleaseSeats] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fullRefund = amount === available;
  return (
    <div
      className="form-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Refund ${booking.ticketNo}`}
    >
      <form
        className="form-modal compact-modal refund-modal"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!Number.isFinite(amount) || amount <= 0 || amount > available) {
            setError(`Enter an amount between PKR 1 and ${money(available)}.`);
            return;
          }
          if (method !== "Cash" && !reference.trim()) {
            setError("Enter the bank, card or 1Bill refund reference.");
            return;
          }
          if (busy) return;
          setBusy(true);
          try { await onRefund(booking.id, {
            id: `RF-${Date.now()}`,
            amount,
            releaseSeats,
            method,
            reason,
            reference:
              reference.trim() || `CASH-${Date.now().toString().slice(-6)}`,
            notes: notes.trim(),
            processedAt: new Date().toISOString(),
            processedBy: "",
          });
          onClose();
          } catch (error) { setError(error instanceof Error ? error.message : "Refund could not be recorded."); }
          finally { setBusy(false); }
        }}
      >
        <header>
          <div>
            <h2>Issue refund</h2>
            <p>
              {booking.ticketNo} · {booking.passenger} · Seats{" "}
              {booking.seats.join(", ")}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <div className="close-shift-summary refund-summary">
          <span>
            <small>Originally paid</small>
            <strong>{money(booking.paid)}</strong>
          </span>
          <span>
            <small>Already refunded</small>
            <strong>{money(refundedTotal(booking))}</strong>
          </span>
          <span>
            <small>Available to refund</small>
            <strong>{money(available)}</strong>
          </span>
        </div>
        <div className="modal-form-grid">
          <label>
            <span>Refund amount *</span>
            <input
              type="number"
              min="1"
              max={available}
              step="1"
              required
              value={amount}
              onChange={(event) => {
                setAmount(Number(event.target.value));
                setError("");
              }}
            />
          </label>
          <label>
            <span>Refund method *</span>
            <select
              value={method}
              onChange={(event) => {
                setMethod(event.target.value as PaymentMethod);
                setError("");
              }}
            >
              {(["Cash", "1Bill", "Card", "Bank transfer"] as PaymentMethod[]).map(
                (option) => (
                  <option key={option}>{option}</option>
                ),
              )}
            </select>
          </label>
          <label>
            <span>Reason *</span>
            <select
              value={reason}
              onChange={(event) =>
                setReason(event.target.value as RefundReason)
              }
            >
              {([
                "Passenger request",
                "Trip cancelled",
                "Duplicate payment",
                "Service disruption",
                "Other",
              ] as RefundReason[]).map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{method === "Cash" ? "Cash voucher reference" : "Refund reference *"}</span>
            <input
              value={reference}
              onChange={(event) => {
                setReference(event.target.value);
                setError("");
              }}
              placeholder={method === "Cash" ? "Optional; generated if blank" : "Required for reconciliation"}
            />
          </label>
          <label className="span-2">
            <span>Internal notes</span>
            <textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional details for the manager"
            />
          </label>
        </div>
        {!fullRefund && booking.bookingStatus === "Confirmed" && <label className="refund-release"><input type="checkbox" checked={releaseSeats} onChange={(event) => setReleaseSeats(event.target.checked)}/><span>Cancel ticket and release its seats</span></label>}
        <div className={`refund-impact ${fullRefund ? "full" : "partial"}`}>
          <RefreshCw size={17} />
          <span>
            <strong>{fullRefund ? "Full refund" : "Partial refund"}</strong>
            <small>
              {fullRefund
                ? "The booking will be marked refunded and all seats will be released."
                : releaseSeats ? `The ticket will be cancelled, seats released and ${money(available - amount)} retained. No automatic fee is applied.` : `The ticket stays confirmed with ${money(available - amount)} still collected.`}
            </small>
          </span>
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>
            Keep booking
          </button>
          <button className="danger-button" type="submit" disabled={busy}>
            <RefreshCw size={16} /> Refund {money(amount)}
          </button>
        </footer>
      </form>
    </div>
  );
}

function BookingsView({
  bookings,
  onPrint,
  onUpdate,
  onRefund,
  canEdit,
  canRefund,
}: {
  bookings: Booking[];
  onPrint: (booking: Booking) => void;
  onUpdate: (booking: Booking) => void;
  onRefund: (id: string, refund: RefundTransaction) => Promise<void>;
  canEdit: boolean;
  canRefund: boolean;
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState<"All" | BookingSource>("All"),
    [editing, setEditing] = useState<Booking | null>(null),
    [refunding, setRefunding] = useState<Booking | null>(null);
  const visible = bookings.filter(
    (b) =>
      b.paid > 0 &&
      b.bookingStatus !== "Reserved" &&
      (filter === "All" || b.source === filter) &&
      `${b.ticketNo} ${b.passenger} ${b.phone} ${b.cnic} ${b.route} ${(b.refunds ?? [])
        .map((refund) => `${refund.reference} ${refund.reason}`)
        .join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="admin-view">
      <ViewHeading
        eyebrow="TICKET REGISTER"
        title="Bookings & refunds"
        text="Find paid tickets, correct passenger details and issue traceable refunds."
        action={
          <button
            className="secondary-button"
            type="button"
            onClick={() =>
              downloadCsv("madina-paid-bookings.csv", [
                [
                  "Ticket",
                  "Passenger",
                  "Mobile",
                  "CNIC",
                  "Route",
                  "Bus",
                  "Seats",
                  "Amount",
                  "Refunded",
                  "Net collected",
                  "Payment",
                  "Payment status",
                  "Date",
                  "Time",
                ],
                ...visible.map((booking) => [
                  booking.ticketNo,
                  booking.passenger,
                  booking.phone,
                  booking.cnic,
                  booking.route,
                  booking.bus,
                  booking.seats.join(" "),
                  booking.paid,
                  refundedTotal(booking),
                  netCollected(booking),
                  booking.paymentMethod,
                  booking.paymentStatus,
                  booking.date,
                  booking.time,
                ]),
              ])
            }
          >
            <FileBarChart size={16} /> Export report
          </button>
        }
      />
      <section className="surface data-surface">
        <DataToolbar
          tabs={["All", "Public web", "Counter"]}
          active={filter}
          onTab={(x) => setFilter(x as "All" | BookingSource)}
          search={search}
          onSearch={setSearch}
          placeholder="Search ticket, passenger or CNIC"
        />
        <BookingTable
          bookings={visible}
          onPrint={onPrint}
          onEdit={canEdit ? setEditing : undefined}
          onRefund={canRefund ? setRefunding : undefined}
        />
      </section>
      {editing && (
        <BookingEditModal
          booking={editing}
          onClose={() => setEditing(null)}
          onSave={(booking) => {
            onUpdate(booking);
            setEditing(null);
          }}
        />
      )}
      {refunding && (
        <RefundModal
          booking={refunding}
          onClose={() => setRefunding(null)}
          onRefund={onRefund}
        />
      )}
    </div>
  );
}

function ReservationsView({
  bookings,
  onConfirm,
  onCancel,
  onNew,
  paymentMode,
}: {
  bookings: Booking[];
  onConfirm: (id: string, method: PaymentMethod, reference: string) => Promise<void>;
  onCancel: (id: string) => void;
  onNew: () => void;
  paymentMode: string;
}) {
  const [collecting, setCollecting] = useState<Booking | null>(null);
  const reservations = bookings.filter((b) => b.bookingStatus === "Reserved");
  return (
    <div className="admin-view">
      <ViewHeading
        eyebrow="UNPAID HOLDS"
        title="Reservations"
        text="Online and counter reservations waiting for payment."
        action={
          <button className="primary-button" type="button" onClick={onNew}>
            <Plus size={16} /> New reservation
          </button>
        }
      />
      <section className="surface data-surface">
        <div className="info-banner">
          <ShieldCheck size={18} />
          <div>
            <strong>Operator-managed reservations</strong>
            <span>
              Seats remain held until an operator collects payment or cancels the reservation.
            </span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reservation</th>
                <th>Passenger</th>
                <th>Journey</th>
                <th>Seats</th>
                <th>Amount due</th>
                <th>Held since</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {reservations.length ? (
                reservations.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.ticketNo}</strong>
                      <small>{b.source}</small>
                    </td>
                    <td>
                      <strong>{b.passenger}</strong>
                      <small>{b.phone}</small>
                    </td>
                    <td>
                      <strong>{b.route}</strong>
                      <small>
                        {b.date} · {b.time}
                      </small>
                    </td>
                    <td>
                      <span className="seat-list">{b.seats.join(", ")}</span>
                    </td>
                    <td>
                      <strong>{money(b.balance)}</strong>
                      <small>Unpaid</small>
                    </td>
                    <td>
                      <strong>
                        {formatPrintTime(b.createdAt)}
                      </strong>
                      <small>Operator managed</small>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="confirm-action"
                          type="button"
                          onClick={() => setCollecting(b)}
                        >
                          <Check size={14} /> Collect & issue
                        </button>
                        <button
                          className="icon-action danger"
                          type="button"
                          aria-label={`Cancel ${b.ticketNo}`}
                          onClick={() => { if (window.confirm(`Cancel reservation ${b.ticketNo} and release seats ${b.seats.join(", ")}?`)) onCancel(b.id); }}
                        >
                          <XCircle size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      title="No active reservations"
                      text="Online and counter reservations appear here."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {collecting && (
        <CollectPaymentModal
          booking={collecting}
          paymentMode={paymentMode}
          onClose={() => setCollecting(null)}
          onConfirm={async (method, reference) => {
            await onConfirm(collecting.id, method, reference);
            setCollecting(null);
          }}
        />
      )}
    </div>
  );
}

function CollectPaymentModal({
  booking,
  paymentMode,
  onClose,
  onConfirm,
}: {
  booking: Booking;
  paymentMode: string;
  onClose: () => void;
  onConfirm: (method: PaymentMethod, reference: string) => Promise<void>;
}) {
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="form-modal-overlay" role="dialog" aria-modal="true" aria-label="Collect reservation payment">
      <form className="form-modal compact-modal" onSubmit={async (event) => {
        event.preventDefault();
        if (method !== "Cash" && !reference.trim()) {
          setError("Enter the verified payment reference.");
          return;
        }
        if (busy) return;
        setBusy(true);
        try { await onConfirm(method, reference.trim()); }
        catch (error) { setError(error instanceof Error ? error.message : "Payment could not be recorded."); }
        finally { setBusy(false); }
      }}>
        <header>
          <div>
            <h2>Collect {money(booking.balance)}</h2>
            <p>{booking.ticketNo} · {booking.passenger} · Seats {booking.seats.join(", ")}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}><X size={19} /></button>
        </header>
        <div className="modal-form-grid">
          <label className="span-2">
            <span>Payment method</span>
            <select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
              <option>Cash</option>
              <option>Card</option>
              <option>Bank transfer</option>
              <option disabled={paymentMode === "disabled"}>1Bill{paymentMode === "disabled" ? " (coming soon)" : ""}</option>
            </select>
          </label>
          {method !== "Cash" && (
            <label className="span-2">
              <span>Verified reference</span>
              <input required value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Transaction reference" />
            </label>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="submit" disabled={busy}><ReceiptText size={16} /> Issue paid ticket</button>
        </footer>
      </form>
    </div>
  );
}

function TripsView({
  bookings, trips, fleet, routes, crew, runs, onSell, onSave, onDelete, onTransition, onReport,
}: {
  bookings: Booking[]; trips: TripRecord[]; fleet: BusRecord[]; routes: RouteRecord[]; crew: CrewRecord[];
  runs: TripRun[]; onSell: (id: string, date: string) => void;
  onSave: (trip: TripRecord) => Promise<void>; onDelete: (id: string) => Promise<void>;
  onTransition: (id: string, action: "boarding" | "depart" | "return", date: string, notes?: string) => Promise<void>;
  onReport: (kind: ReportKind, tripId: string, run: number, date?: string) => void;
}) {
  const [editing, setEditing] = useState<TripRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<TripRecord | null>(null);
  const [openTrip, setOpenTrip] = useState<{ id: string; date: string } | null>(null);
  const [serviceDate, setServiceDate] = useState(today);
  const [filter, setFilter] = useState("This date");
  const visible = filter === "This date"
    ? tripsOnDate(trips, serviceDate, runs).map((trip) => ({ trip, date: serviceDate }))
    : runs.filter((run) => filter === "On route" ? run.status === "Departed" : ["Departed", "Returned"].includes(run.status))
      .flatMap((run) => { const trip = trips.find((item) => item.id === run.tripId); return trip ? [{ trip: tripOnDate(trip, run.date, runs), date: run.date }] : []; });
  const modalTrip = openTrip && trips.find((trip) => trip.id === openTrip.id);
  return (
    <div className="admin-view">
      <ViewHeading eyebrow="" title="Roster" text="Boarding, departure and return are recorded here."
        action={<button className="primary-button" type="button" disabled={!routes.length || !fleet.length} onClick={() => setEditing("new")}><Plus size={16} /> Add schedule</button>} />
      <section className="surface data-surface">
        <div className="data-toolbar">
          <div className="date-switcher"><label><CalendarDays size={17}/><span>Service date</span><input type="date" value={serviceDate} onChange={(event) => { setServiceDate(event.target.value); setFilter("This date"); }}/></label></div>
          <div className="filter-tabs">{["This date", "On route", "History"].map((label) => <button type="button" key={label} className={filter === label ? "active" : ""} onClick={() => setFilter(label)}>{label}</button>)}</div>
        </div>
        <div className="trip-cards" role="table" aria-label="Departures">
          <div className="trip-table-head" role="row"><span>Time</span><span>Route</span><span>Bus</span><span>Crew</span><span>Seats</span><span>Status</span><span>Actions</span></div>
          {visible.map(({trip, date}) => {
            const bus = tripBus(trip, fleet), route = tripRoute(trip, routes);
            if (!bus || !route) return null;
            const records = bookings.filter((booking) => booking.tripRunId === tripRunKey(trip, trip.runNumber, date));
            const paid = records.filter((booking) => booking.bookingStatus === "Confirmed").reduce((sum, booking) => sum + booking.seats.length, 0);
            const held = records.filter((booking) => booking.bookingStatus === "Reserved").reduce((sum, booking) => sum + booking.seats.length, 0);
            const currentBus = fleet.find((item) => item.id === trip.busId) ?? bus;
            const closed = ["Departed", "Returned", "Cancelled"].includes(trip.status);
            return <article key={trip.id + date} role="row">
              <div className="trip-card-time"><strong>{trip.departure}</strong><small>{date}</small></div>
              <div className="trip-card-route"><div><strong>{routeLabel(route)}</strong><small>{trip.active ? trip.days.join(" · ") : "Schedule paused"}</small></div></div>
              <div><strong>{bus.registration}</strong><small>{currentBus.status}</small></div>
              <div><strong>{trip.driver}</strong><small>{trip.attendant}</small></div>
              <div><strong>{paid} paid · {held} held</strong><small>{bus.seats - paid - held} available</small></div>
              <div><b className={`plain-status ${trip.status.toLowerCase()}`}>{trip.status}</b>{trip.departedAt && <small>Left {formatPrintTime(trip.departedAt)}</small>}{trip.returnedAt && <small>Returned {formatPrintTime(trip.returnedAt)}</small>}</div>
              <div className="trip-actions">
                <RunAction trip={trip} bus={currentBus} date={date} onTransition={(action, notes) => onTransition(trip.id, action, date, notes)} />
                <button className="text-action" type="button" onClick={() => setOpenTrip({id: trip.id, date})}>Passengers</button>
                {!closed && date >= today && <button className="text-action" type="button" disabled={["Maintenance","Retired"].includes(currentBus.status) || !trip.active} onClick={() => onSell(trip.id, date)}>Sell</button>}
                <button className="text-action" type="button" onClick={() => setEditing(trips.find((item) => item.id === trip.id) ?? trip)}>Schedule</button>
                <button className="icon-action danger" type="button" aria-label={`Delete ${routeLabel(route)} trip`} onClick={() => setDeleting(trip)}><Trash2 size={15}/></button>
              </div>
            </article>;
          })}
          {!visible.length && <EmptyState title="No departures" text={filter === "On route" ? "All recorded departures have returned." : "Select another date or add a schedule."}/>}
        </div>
      </section>
      {editing && <TripFormModal trip={editing === "new" ? undefined : editing} fleet={fleet} routes={routes} crew={crew} onClose={() => setEditing(null)} onSave={async (trip) => { await onSave(trip); setEditing(null); }}/>}
      {deleting && <ConfirmDeleteModal title="Delete schedule?" item={deleting.id} text="Schedules with tickets or movement history must be paused instead." onClose={() => setDeleting(null)} onConfirm={async () => { await onDelete(deleting.id); setDeleting(null); }}/>}
      {modalTrip && openTrip && <TripRunModal trip={tripOnDate(modalTrip, openTrip.date, runs)} fleet={fleet} bookings={bookings} routes={routes} serviceDate={openTrip.date} onClose={() => setOpenTrip(null)} onTransition={(action, notes) => onTransition(modalTrip.id, action, openTrip.date, notes)} onReport={onReport}/>}
    </div>
  );
}

function RunAction({ trip, bus, date, onTransition }: {
  trip: TripRecord; bus: BusRecord; date: string;
  onTransition: (action: "boarding" | "depart" | "return", notes?: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notes, setNotes] = useState("");
  if (["Returned","Cancelled"].includes(trip.status)) return null;
  const action = trip.status === "Scheduled" ? "boarding" : trip.status === "Boarding" ? "depart" : "return";
  const label = action === "boarding" ? "Start boarding" : action === "depart" ? "Depart bus" : "Record return";
  const disabled = action !== "return" && (date !== today || !trip.active || bus.status !== "Ready");
  return <>
    <button className="lifecycle-action" type="button" disabled={disabled} title={disabled ? "Only today's active departure with a ready bus can proceed." : label} onClick={() => {setError("");setConfirming(true);}}>{label}</button>
    {confirming && <div className="form-modal-overlay" role="dialog" aria-modal="true" aria-label={label}>
      <form className="form-modal compact-modal" onSubmit={async (event) => { event.preventDefault();setBusy(true);try {await onTransition(action, notes);setConfirming(false);} catch(e) {setError(e instanceof Error ? e.message : "Could not save.");} finally {setBusy(false);} }}>
        <header><div><h2>{label}</h2><p>{bus.registration} · {date} · {trip.departure}</p></div><button type="button" disabled={busy} onClick={() => setConfirming(false)} aria-label="Close"><X size={18}/></button></header>
        <div className="modal-form-grid"><p className="span-2">{action === "depart" ? "Collect or cancel all unpaid reservations first. Departure closes ticket sales for this bus and date." : action === "return" ? "This saves the return time and makes the bus available again. Its departure and passenger history remain saved." : "Check that the bus and crew are ready."}</p>
        {action === "return" && <label className="span-2"><span>Return note (optional)</span><textarea value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)}/></label>}</div>
        {error && <p className="form-error">{error}</p>}
        <footer><button className="secondary-button" type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Saving…" : label}</button></footer>
      </form>
    </div>}
  </>;
}

function FleetView({
  fleet,
  onSave,
  onDelete,
}: {
  fleet: BusRecord[];
  onSave: (bus: BusRecord) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<BusRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<BusRecord | null>(null);
  return (
    <div className="admin-view">
      <ViewHeading
        eyebrow="VEHICLES"
        title="Fleet management"
        text="Capacity, operating status and maintenance planning."
        action={
          <button
            className="primary-button"
            type="button"
            onClick={() => setEditing("new")}
          >
            <Plus size={16} /> Add bus
          </button>
        }
      />
      <div className="fleet-summary">
        <span>
          <strong>{fleet.length}</strong>
          <small>Total buses</small>
        </span>
        <span>
          <strong>
            {fleet.filter((bus) => bus.status === "Ready").length}
          </strong>
          <small>Ready</small>
        </span>
        <span>
          <strong>
            {fleet.filter((bus) => bus.status === "On route").length}
          </strong>
          <small>On route</small>
        </span>
        <span>
          <strong>
            {fleet.filter((bus) => bus.status === "Maintenance").length}
          </strong>
          <small>Maintenance</small>
        </span>
      </div>
      <section className="fleet-grid">
        {fleet.map((b) => (
          <article className="surface fleet-card" key={b.id}>
            <div className="fleet-card-top">
              <span>
                <BusFront size={23} />
              </span>
              <b
                className={`plain-status ${b.status.toLowerCase().replace(" ", "-")}`}
              >
                {b.status}
              </b>
            </div>
            <h2>{b.registration}</h2>
            <p>
              {b.model} · {b.year}
            </p>
            <div className="fleet-details">
              <span>
                <small>Service class</small>
                <strong>{b.service}</strong>
              </span>
              <span>
                <small>Seat capacity</small>
                <strong>{b.seats} seats</strong>
              </span>
              <span>
                <small>Next service</small>
                <strong>{b.nextService}</strong>
              </span>
            </div>
            <div className="fleet-card-actions">
              {b.status === "On route" && <span className="system-note">Return is recorded in Roster.</span>}
              <button type="button" onClick={() => setEditing(b)}>
                Edit bus <ChevronRight size={15} />
              </button>
              <button
                className="danger-text-button"
                type="button"
                aria-label={`Delete ${b.registration}`}
                onClick={() => setDeleting(b)}
              >
                <Trash2 size={15} /> Delete
              </button>
            </div>
          </article>
        ))}
      </section>
      {editing && (
        <BusFormModal
          bus={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(bus) => {
            onSave(bus);
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDeleteModal
          title="Delete bus?"
          item={deleting.registration}
          text="A bus assigned to a trip cannot be deleted until the trip is reassigned or removed."
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await onDelete(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

function TripFormModal({
  trip,
  fleet,
  routes,
  crew,
  onClose,
  onSave,
}: {
  trip?: TripRecord;
  fleet: BusRecord[];
  routes: RouteRecord[];
  crew: CrewRecord[];
  onClose: () => void;
  onSave: (trip: TripRecord) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<TripRecord>(
    trip ?? {
      id: "new-trip",
      routeId: routes[0].id,
      busId:
        fleet.find((bus) => bus.status === "Ready")?.id ?? fleet[0]?.id ?? "",
      departure: "08:00",
      arrival: "14:00",
      driver: crew.find((person) => person.role === "Driver")?.name ?? "",
      attendant:
        crew.find((person) => person.role === "Female attendant")?.name ?? "",
      platform: "P-01",
      status: "Scheduled",
      days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      active: true,
      runNumber: 1,
    },
  );
  const update = <K extends keyof TripRecord>(key: K, value: TripRecord[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.days.length) return setError("Select at least one running day.");
    if (!draft.busId || !draft.driver || !draft.attendant)
      return setError("Assign a bus, driver and female attendant.");
    if (busy) return;
    setBusy(true);
    try { await onSave({ ...draft, id: trip ? draft.id : `trip-${Date.now()}` }); }
    catch (error) { setError(error instanceof Error ? error.message : "Schedule could not be saved."); }
    finally { setBusy(false); }
  };
  return (
    <div
      className="form-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={trip ? "Edit trip" : "Create trip"}
    >
      <form className="form-modal" onSubmit={submit}>
        <header>
          <div>
            <h2>{trip ? "Edit recurring trip" : "Create recurring trip"}</h2>
            <p>
              Set it once. It will repeat on the selected days until paused or
              edited.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <div className="modal-form-grid">
          <label className="span-2">
            <span>Route</span>
            <select
              value={draft.routeId}
              onChange={(event) => update("routeId", event.target.value)}
            >
              {routes
                .filter((route) => route.status === "Active")
                .map((route) => (
                  <option value={route.id} key={route.id}>
                    {routeLabel(route)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Departure</span>
            <input
              type="time"
              value={draft.departure}
              onChange={(event) => update("departure", event.target.value)}
            />
          </label>
          <label>
            <span>Arrival</span>
            <input
              type="time"
              value={draft.arrival}
              onChange={(event) => update("arrival", event.target.value)}
            />
          </label>
          <label className="span-2">
            <span>Bus</span>
            <select
              value={draft.busId}
              onChange={(event) => update("busId", event.target.value)}
            >
              {fleet
                .filter((bus) => bus.status !== "Retired")
                .map((bus) => (
                  <option value={bus.id} key={bus.id}>
                    {bus.registration} · {bus.service} · {bus.seats} seats
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Driver</span>
            <select
              value={draft.driver}
              onChange={(event) => update("driver", event.target.value)}
            >
              {crew
                .filter((person) => person.role === "Driver")
                .map((person) => (
                  <option key={person.name}>{person.name}</option>
                ))}
            </select>
          </label>
          <label>
            <span>Female attendant</span>
            <select
              value={draft.attendant}
              onChange={(event) => update("attendant", event.target.value)}
            >
              {crew
                .filter((person) => person.role === "Female attendant")
                .map((person) => (
                  <option key={person.name}>{person.name}</option>
                ))}
            </select>
          </label>
          <label>
            <span>Platform</span>
            <input
              value={draft.platform}
              onChange={(event) => update("platform", event.target.value)}
              placeholder="P-01"
            />
          </label>

          <fieldset className="weekday-field span-2">
            <legend>Running days</legend>
            <div>
              {weekdays.map((day) => (
                <button
                  type="button"
                  title={day}
                  aria-pressed={draft.days.includes(day)}
                  className={draft.days.includes(day) ? "active" : ""}
                  key={day}
                  onClick={() =>
                    update(
                      "days",
                      draft.days.includes(day)
                        ? draft.days.filter((item) => item !== day)
                        : [...draft.days, day],
                    )
                  }
                >
                  {day.slice(0, 1)}
                </button>
              ))}
            </div>
            <small>
              {draft.days.length === 7
                ? "Runs every day"
                : draft.days.join(" · ")}
            </small>
          </fieldset>
          <label className="switch-field span-2">
            <span>
              <strong>Schedule active</strong>
              <small>
                Pause this to stop future sales without deleting the trip.
              </small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={draft.active}
              className={`toggle ${draft.active ? "on" : ""}`}
              onClick={() => update("active", !draft.active)}
            >
              <span />
            </button>
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            <Check size={16} /> Save trip
          </button>
        </footer>
      </form>
    </div>
  );
}

function BusFormModal({
  bus,
  onClose,
  onSave,
}: {
  bus?: BusRecord;
  onClose: () => void;
  onSave: (bus: BusRecord) => void;
}) {
  const [draft, setDraft] = useState<BusRecord>(
    bus ?? {
      id: "new-bus",
      registration: "",
      service: "Executive",
      seats: 49,
      model: "",
      year: new Date().getFullYear(),
      status: "Ready",
      nextService: "",
    },
  );
  const update = <K extends keyof BusRecord>(key: K, value: BusRecord[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div
      className="form-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={bus ? "Edit bus" : "Add bus"}
    >
      <form
        className="form-modal compact-modal"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.registration.trim() && draft.model.trim())
            onSave({
              ...draft,
              id: bus ? draft.id : `bus-${Date.now()}`,
              registration: draft.registration.trim().toUpperCase(),
              model: draft.model.trim(),
            });
        }}
      >
        <header>
          <div>
            <h2>{bus ? `Edit ${bus.registration}` : "Add bus"}</h2>
            <p>Vehicle details and operating status.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <div className="modal-form-grid">
          <label>
            <span>Registration number *</span>
            <input
              required
              value={draft.registration}
              onChange={(event) => update("registration", event.target.value)}
              placeholder="TAE-388"
            />
          </label>
          <label>
            <span>Service class</span>
            <select
              value={draft.service}
              onChange={(event) => update("service", event.target.value)}
            >
              <option>Standard Plus</option>
              <option>Executive</option>
              <option>Sleeper Bus</option>
              <option>Business Class</option>
            </select>
          </label>
          <label className="span-2">
            <span>Make / model *</span>
            <input
              required
              value={draft.model}
              onChange={(event) => update("model", event.target.value)}
              placeholder="Yutong ZK6122H9"
            />
          </label>
          <label>
            <span>Model year</span>
            <input
              type="number"
              min="1990"
              max="2035"
              value={draft.year}
              onChange={(event) => update("year", Number(event.target.value))}
            />
          </label>
          <label>
            <span>Seat capacity</span>
            <select
              value={draft.seats}
              onChange={(event) => update("seats", Number(event.target.value))}
            >
              <option value="35">35 seats</option>
              <option value="41">41 seats</option>
              <option value="44">44 seats</option>
              <option value="49">49 seats</option>
            </select>
          </label>
          <label>
            <span>Operating status</span>
            <select
              value={draft.status}
              onChange={(event) =>
                update("status", event.target.value as BusRecord["status"])
              }
            >
              <option>Ready</option>
              {draft.status === "On route" && <option disabled>On route</option>}
              <option>Maintenance</option>
              <option>Retired</option>
            </select>
          </label>
          <label>
            <span>Next service</span>
            <input
              value={draft.nextService}
              onChange={(event) => update("nextService", event.target.value)}
              placeholder="18 Sep 2026"
            />
          </label>
        </div>
        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            <Check size={16} /> Save bus
          </button>
        </footer>
      </form>
    </div>
  );
}

function TripRunModal({
  trip,
  fleet,
  bookings,
  routes,
  serviceDate,
  onClose,
  onTransition,
  onReport,
}: {
  trip: TripRecord;
  fleet: BusRecord[];
  bookings: Booking[];
  routes: RouteRecord[];
  serviceDate: string;
  onClose: () => void;
  onTransition: (action: "boarding" | "depart" | "return", notes?: string) => Promise<void>;
  onReport: (
    kind: ReportKind,
    tripId: string,
    runNumber: number,
    date?: string,
  ) => void;
}) {
  const bus = tripBus(trip, fleet);
  const route = tripRoute(trip, routes);
  const runBookings = trip.snapshot?.passengers ?? bookingsForTripRun(
    bookings,
    trip,
    bus,
    trip.runNumber,
    serviceDate,
  );
  const passengerRows = runBookings.flatMap((booking) =>
    booking.seats.map((seat) => ({ booking, seat })),
  );
  return (
    <div
      className="form-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Current trip run"
    >
      <section className="form-modal run-modal">
        <header>
          <div>
            <h2>
              {routeLabel(route)} · {trip.departure}
            </h2>
            <p>
              {serviceDate} · {bus.registration} · Run {trip.runNumber} ·{" "}
              {trip.platform}
            </p>
          </div>
          <span className={`run-status-banner ${trip.status.toLowerCase()}`}>
            <i /> {trip.status === "Departed" ? "Bus on route" : trip.status}
          </span>
          <button type="button" aria-label="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        {trip.notes && <p className="system-note">{trip.notes}</p>}
        <div className="run-summary">
          <span>
            <small>Paid seats</small>
            <strong>
              {passengerRows.length} / {bus.seats}
            </strong>
          </span>
          <span>
            <small>Collection</small>
            <strong>
              {money(
                runBookings.reduce(
                  (sum, booking) => sum + netCollected(booking),
                  0,
                ),
              )}
            </strong>
          </span>
          <span>
            <small>Driver</small>
            <strong>{trip.driver}</strong>
          </span>
          <span>
            <small>Female attendant</small>
            <strong>{trip.attendant}</strong>
          </span>
        </div>
        <div className="run-report-actions">
          <button
            type="button"
            onClick={() =>
              onReport("manifest", trip.id, trip.runNumber, serviceDate)
            }
          >
            <FileText size={16} /> Manifest
          </button>
          <button
            type="button"
            onClick={() =>
              onReport("cnic", trip.id, trip.runNumber, serviceDate)
            }
          >
            <FileBarChart size={16} /> CNIC sheet
          </button>
          <button
            type="button"
            onClick={() =>
              onReport("terminal-a4", trip.id, trip.runNumber, serviceDate)
            }
          >
            <Printer size={16} /> A4 voucher
          </button>
          <button
            type="button"
            onClick={() =>
              onReport("terminal-thermal", trip.id, trip.runNumber, serviceDate)
            }
          >
            <ReceiptText size={16} /> Thermal voucher
          </button>
        </div>
        <div className="table-wrap run-table">
          <table>
            <thead>
              <tr>
                <th>Seat</th>
                <th>Passenger</th>
                <th>CNIC</th>
                <th>Mobile</th>
                <th>Print time</th>
                <th>Ticket</th>
              </tr>
            </thead>
            <tbody>
              {passengerRows.length ? (
                passengerRows.map(({ booking, seat }) => (
                  <tr key={`${booking.id}-${seat}`}>
                    <td>
                      <span className="seat-list">{seat}</span>
                    </td>
                    <td>
                      <strong>{booking.passenger}</strong>
                      <small>{booking.gender}</small>
                    </td>
                    <td>
                      <strong>{booking.cnic}</strong>
                    </td>
                    <td>
                      <strong>{booking.phone}</strong>
                    </td>
                    <td>
                      <strong>
                        {formatPrintTime(
                          booking.seatPrintedAt ?? booking.createdAt,
                        )}
                      </strong>
                    </td>
                    <td>
                      <strong>{booking.ticketNo}</strong>
                      <small>{booking.source}</small>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      title="Fresh passenger run"
                      text="New tickets for this departure will appear here."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>
            Close
          </button>
          <RunAction trip={trip} bus={fleet.find((item) => item.id === trip.busId) ?? bus} date={serviceDate} onTransition={onTransition} />
        </footer>
      </section>
    </div>
  );
}

function ReportsView({bookings, trips, fleet, routes, runs, onReport, onSell, onPrintTicket}: {
  bookings: Booking[]; trips: TripRecord[]; fleet: BusRecord[]; routes: RouteRecord[]; runs: TripRun[];
  onReport: (kind: ReportKind, id: string, run: number, date?: string) => void;
  onSell?: (id: string, date: string) => void; onPrintTicket: (booking: Booking) => void;
}) {
  const [reportDate, setReportDate] = useState(today), [tripId, setTripId] = useState(""), [query, setQuery] = useState("");
  const options = tripsOnDate(trips, reportDate, runs);
  const trip = options.find((item) => item.id === tripId) ?? options[0];
  const bus = trip && tripBus(trip, fleet), route = trip && tripRoute(trip, routes);
  const records = trip ? bookings.filter((booking) => booking.tripRunId === tripRunKey(trip, trip.runNumber, reportDate)) : [];
  const cards: {kind: ReportKind; title: string; format: string; text: string}[] = [
    {kind:"manifest",title:"Bus detail",format:"A4",text:"Passengers, seats, route, crew and ticket details."},
    {kind:"cnic",title:"CNIC sheet",format:"A4",text:"Confirmed passenger list for highway checks."},
    {kind:"terminal-a4",title:"Terminal voucher",format:"A4",text:"Ticket sales, receipts, refunds and payment totals."},
    {kind:"terminal-thermal",title:"Terminal voucher",format:"80mm",text:"The same voucher totals for a thermal printer."},
  ];
  const history = runs.filter((run) => ["Departed","Returned"].includes(run.status));
  return <div className="admin-view reports-view">
    <ViewHeading eyebrow="" title="Print" text="Select a departure to review its records and print." />
    <section className="surface report-selector">
      <label><span>Service date</span><input type="date" value={reportDate} onChange={(event) => {setReportDate(event.target.value);setTripId("");}} /></label>
      <label><span>Bus / route</span><select value={trip?.id ?? ""} onChange={(event) => setTripId(event.target.value)}>
        {!options.length && <option value="">No departures for this date</option>}
        {options.map((item) => <option value={item.id} key={item.id}>{item.departure} · {tripBus(item,fleet)?.registration} · {tripRoute(item,routes) ? routeLabel(tripRoute(item,routes)) : ""} · {item.status}</option>)}
      </select></label>
      <label><span>Previous departures</span><select value="" onChange={(event) => {const run = runs.find((item) => item.id === event.target.value);if(run){setReportDate(run.date);setTripId(run.tripId);}}}>
        <option value="">Choose a recorded departure</option>{history.map((run) => <option key={run.id} value={run.id}>{run.date} · {run.snapshot?.bus.registration} · {run.snapshot?.route.from} → {run.snapshot?.route.to} · {run.status}</option>)}
      </select></label>
      {trip && bus && route && <div className="report-trip-summary"><span><small>Bus</small><strong>{bus.registration}</strong></span><span><small>Route</small><strong>{routeLabel(route)}</strong></span><span><small>Status</small><strong>{trip.status}</strong></span><span><small>Tickets</small><strong>{records.length}</strong></span></div>}
    </section>
    {trip && <><section className="report-card-grid">{cards.map((card) => <article className="surface report-card" key={card.kind}><div><b>{card.format}</b><h2>{card.title}</h2><p>{card.text}</p></div><button className="primary-button" type="button" onClick={() => onReport(card.kind,trip.id,trip.runNumber,reportDate)}><Printer size={16}/> Preview & print</button></article>)}</section>
    <section className="surface data-surface">
      <SurfaceHeader title="Tickets" text="" action={onSell && reportDate >= today && !["Departed","Returned","Cancelled"].includes(trip.status) ? <button type="button" onClick={() => onSell(trip.id,reportDate)}><Plus size={16}/> Add passenger</button> : undefined}/>
      <label className="search-box"><Search size={16}/><input placeholder="Find passenger, ticket or CNIC" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
      <BookingTable bookings={records.filter((booking) => `${booking.passenger} ${booking.ticketNo} ${booking.cnic}`.toLowerCase().includes(query.toLowerCase()))} onPrint={onPrintTicket}/>
    </section></>}
    {!trip && <EmptyState title="No departures for this date" text="Choose a previous departure above or add a schedule in Roster."/>}
  </div>;
}

function ReportModal({
  runs,
  preparedBy,
  report,
  bookings,
  trips,
  fleet,
  routes,
  onClose,
}: {
  runs: TripRun[];
  preparedBy: string;
  report: {
    kind: ReportKind;
    tripId: string;
    runNumber: number;
    date: string;
  };
  bookings: Booking[];
  trips: TripRecord[];
  fleet: BusRecord[];
  routes: RouteRecord[];
  onClose: () => void;
}) {
  const baseTrip = trips.find((item) => item.id === report.tripId);
  if (!baseTrip) return null;
  const trip = tripOnDate(baseTrip, report.date, runs);
  const bus = tripBus(trip, fleet);
  const route = tripRoute(trip, routes);
  const currentPassengers = bookingsForTripRun(
    bookings,
    trip,
    bus,
    report.runNumber,
    report.date,
  );
  const runBookings = trip.snapshot?.passengers ?? currentPassengers;
  const records = bookings.filter((booking) => booking.tripRunId === tripRunKey(trip, report.runNumber, report.date));
  const voucher = report.kind.startsWith("terminal");
  const gross = records.reduce((sum, booking) => sum + booking.paid, 0);
  const refunds = records.reduce((sum, booking) => sum + refundedTotal(booking), 0);
  const reservedSeats = records.filter((booking) => booking.bookingStatus === "Reserved").reduce((sum, booking) => sum + booking.seats.length, 0);
  const boardingAt = runs.find((run) => run.tripId === trip.id && run.date === report.date)?.boardingStartedAt;
  const boardingTickets = boardingAt ? records.filter((booking) => new Date(booking.createdAt) >= new Date(boardingAt)).length : 0;
  const methodTotal = (method: PaymentMethod) => records.reduce((sum, booking) => sum + (booking.paymentMethod === method ? booking.paid : 0) - (booking.refunds ?? []).filter((refund) => refund.method === method).reduce((amount, refund) => amount + refund.amount, 0), 0);
  const printedBookings = voucher ? records : report.kind === "cnic" ? runBookings : [...runBookings, ...records.filter((booking) => booking.bookingStatus === "Reserved")];
  const rows = printedBookings.flatMap((booking) =>
    booking.seats.map((seat) => ({ booking, seat })),
  );
  const total = gross - refunds;
  const totals = [["Tickets issued", records.filter((booking) => booking.paid > 0).length], ["Passenger seats", runBookings.reduce((sum, booking) => sum + booking.seats.length, 0)], ["Reserved seats", reservedSeats], ["Added during boarding", boardingTickets], ["Payments received", money(gross)], ["Refunds", money(refunds)], ["Net cash", money(methodTotal("Cash"))], ["Net card", money(methodTotal("Card"))], ["Net bank transfer", money(methodTotal("Bank transfer"))], ["Net 1Bill", money(methodTotal("1Bill"))], ["Net collected", money(total)]];
  const title = {
    manifest: "Bus Detail",
    cnic: "Passenger CNIC Sheet",
    "terminal-a4": "Terminal Voucher Report",
    "terminal-thermal": "Terminal Voucher",
  }[report.kind];
  const thermal = report.kind === "terminal-thermal";
  const printReport = () => {
    const printClass = thermal ? "printing-thermal" : "printing-a4";
    const cleanup = () => document.body.classList.remove(printClass);
    document.body.classList.add(printClass);
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    window.setTimeout(cleanup, 1500);
  };
  return (
    <div
      className="report-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="report-preview-shell">
        <div className="report-toolbar">
          <div>
            <strong>{title}</strong>
            <small>
              {thermal ? "80mm thermal printer" : "A4 landscape"} ·{" "}
              {rows.length} passenger seats
            </small>
          </div>
          <div>
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
            >
              Close
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={printReport}
            >
              <Printer size={16} /> Print
            </button>
          </div>
        </div>
        <article
          className={`print-document ${thermal ? "report-thermal" : "report-a4 report-landscape"}`}
        >
          <header className="document-header">
            <div>
              <h1>MADINA EXPRESS</h1>
              <h2>{title}</h2>
              <p>Madina Terminal, Peshawar · 0311-777-2299</p>
            </div>
          </header>
          <div className="document-meta">
            <span>
              <small>Route</small>
              <strong>{routeLabel(route)}</strong>
            </span>
            <span>
              <small>Departure</small>
              <strong>
                {report.date} · {trip.departure}
              </strong>
            </span>
            <span>
              <small>Bus</small>
              <strong>
                {bus.registration} · {bus.service}
              </strong>
            </span>
            <span>
              <small>Status / Platform</small>
              <strong>
                {trip.status} · {trip.platform}
              </strong>
            </span>
            <span>
              <small>Driver</small>
              <strong>{trip.driver}</strong>
            </span>
            <span>
              <small>Female attendant</small>
              <strong>{trip.attendant}</strong>
            </span>
          </div>
          {thermal ? (
            <>
              <div className="thermal-rule" />
              {rows.map(({ booking, seat }) => (
                <div
                  className="thermal-passenger"
                  key={`${booking.id}-${seat}`}
                >
                  <span>
                    <b>Seat {seat}</b>
                    <strong>{booking.passenger}</strong>
                  </span>
                  <span>
                    <small>
                      {booking.destination} · {booking.ticketNo}
                    </small>
                    <b>{money(netCollected(booking) / booking.seats.length)}</b>
                  </span>
                  <small>
                    {booking.bookingStatus} ·{" "}
                    {formatPrintTime(
                      booking.seatPrintedAt ?? booking.createdAt,
                    )}
                  </small>
                </div>
              ))}
              {!rows.length && (
                <p className="document-empty">No passengers in this run.</p>
              )}
              <div className="thermal-total">{totals.map(([label, value]) => <span key={label}>{label}<b>{value}</b></span>)}</div>
            </>
          ) : report.kind === "terminal-a4" ? (
            <>
              <table className="document-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Issued by / time</th>
                    <th>Passenger</th>
                    <th>Destination</th>
                    <th>Seats</th>
                    <th>Channel</th>
                    <th>Paid / refund / net</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((booking) => (
                    <tr key={booking.id}>
                      <td>{booking.ticketNo}<small>{booking.bookingStatus}</small></td>
                      <td>
                        {booking.issuedBy ?? "Web / Counter"}
                        <small>
                          {formatPrintTime(
                            booking.seatPrintedAt ?? booking.createdAt,
                          )}
                        </small>
                      </td>
                      <td>{booking.passenger}</td>
                      <td>{booking.destination}</td>
                      <td>{booking.seats.join(", ")}</td>
                      <td>{booking.paymentMethod}</td>
                      <td>{money(booking.paid)}<small>Refund {money(refundedTotal(booking))} · Net {money(netCollected(booking))}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="voucher-summary-grid">{totals.map(([label,value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div>
            </>
          ) : (
            <table className="document-table">
              <thead>
                <tr>
                  {report.kind === "cnic" ? (
                    <>
                      <th>Seat #</th>
                      <th>Terminal</th>
                      <th>Destination</th>
                      <th>User ID</th>
                      <th>Status</th>
                      <th>Type</th>
                      <th>Seat print time</th>
                      <th>Passenger name</th>
                      <th>CNIC number</th>
                    </>
                  ) : (
                    <>
                      <th>Seat / ticket</th>
                      <th>Passenger</th>
                      <th>Gender</th>
                      <th>Mobile</th>
                      <th>CNIC / Passport</th>
                      <th>Destination</th>
                      <th>Boarding</th>
                      <th>Fare</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ booking, seat }) =>
                  report.kind === "cnic" ? (
                    <tr key={`${booking.id}-${seat}`}>
                      <td>{seat}</td>
                      <td>{booking.terminal ?? "Peshawar"}</td>
                      <td>{booking.destination}</td>
                      <td>{booking.issuedBy ?? "Online"}</td>
                      <td>{booking.bookingStatus}</td>
                      <td>{booking.source}</td>
                      <td>
                        {formatPrintTime(
                          booking.seatPrintedAt ?? booking.createdAt,
                        )}
                      </td>
                      <td>{booking.passenger}</td>
                      <td>{booking.cnic}</td>
                    </tr>
                  ) : (
                    <tr key={`${booking.id}-${seat}`}>
                      <td>{seat}<small>{booking.ticketNo}</small></td>
                      <td>{booking.passenger}<small>{booking.bookingStatus} · {booking.paymentMethod}</small></td>
                      <td>{booking.gender}</td>
                      <td>{booking.phone}</td>
                      <td>{booking.cnic}</td>
                      <td>{booking.destination}</td>
                      <td>{booking.boardingPoint}</td>
                      <td>{money(booking.total / booking.seats.length)}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
          {!voucher && <p className="document-empty">Passengers: {rows.length} · {trip.departedAt ? `Departed ${formatPrintTime(trip.departedAt)}` : "Before departure"}{trip.returnedAt ? ` · Returned ${formatPrintTime(trip.returnedAt)}` : ""}</p>}
          <footer className="document-footer">
            <span>Printed {new Date().toLocaleString("en-PK", {timeZone: "Asia/Karachi"})}</span>
            <span>Prepared by {preparedBy}</span>
          </footer>
        </article>
      </div>
    </div>
  );
}

function RouteFormModal({
  route,
  onClose,
  onSave,
}: {
  route?: RouteRecord;
  onClose: () => void;
  onSave: (route: RouteRecord) => void;
}) {
  const [draft, setDraft] = useState<RouteRecord>(
    route ?? {
      id: "new-route",
      from: "Peshawar",
      to: "",
      distance: "",
      duration: "",
      fare: 0,
      boarding: "Madina Terminal, Peshawar",
      status: "Active",
    },
  );
  const update = <K extends keyof RouteRecord>(key: K, value: RouteRecord[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div
      className="form-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={route ? "Edit route" : "Add route"}
    >
      <form
        className="form-modal compact-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ ...draft, id: route ? draft.id : `route-${Date.now()}` });
        }}
      >
        <header>
          <div>
            <h2>{route ? "Edit route & fare" : "Add route"}</h2>
            <p>City pair, boarding terminal and per-seat fare.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <div className="modal-form-grid">
          <label>
            <span>Leaving from *</span>
            <input
              required
              value={draft.from}
              onChange={(event) => update("from", event.target.value)}
            />
          </label>
          <label>
            <span>Going to *</span>
            <input
              required
              value={draft.to}
              onChange={(event) => update("to", event.target.value)}
              placeholder="Destination city"
            />
          </label>
          <label>
            <span>Distance</span>
            <input
              required
              value={draft.distance}
              onChange={(event) => update("distance", event.target.value)}
              placeholder="520 km"
            />
          </label>
          <label>
            <span>Travel time</span>
            <input
              required
              value={draft.duration}
              onChange={(event) => update("duration", event.target.value)}
              placeholder="5h 45m"
            />
          </label>
          <label>
            <span>Base fare (PKR)</span>
            <input
              required
              type="number"
              min="0"
              step="50"
              value={draft.fare}
              onChange={(event) => update("fare", Number(event.target.value))}
            />
          </label>
          <label>
            <span>Status</span>
            <select
              value={draft.status}
              onChange={(event) =>
                update("status", event.target.value as RouteRecord["status"])
              }
            >
              <option>Active</option>
              <option>Paused</option>
            </select>
          </label>
          <label className="span-2">
            <span>Boarding terminal *</span>
            <input
              required
              value={draft.boarding}
              onChange={(event) => update("boarding", event.target.value)}
            />
          </label>
        </div>
        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            <Check size={16} /> Save route
          </button>
        </footer>
      </form>
    </div>
  );
}

function RoutesView({
  routes,
  onSave,
  onDelete,
}: {
  routes: RouteRecord[];
  onSave: (route: RouteRecord) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<RouteRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<RouteRecord | null>(null);
  const [filter, setFilter] = useState<"Active routes" | "Paused">(
    "Active routes",
  );
  const [search, setSearch] = useState("");
  const visibleRoutes = routes.filter(
    (route) =>
      (filter === "Active routes"
        ? route.status === "Active"
        : route.status === "Paused") &&
      `${route.from} ${route.to} ${route.boarding}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="admin-view">
      <ViewHeading
        eyebrow="NETWORK & PRICING"
        title="Routes & fares"
        text="Manage active city pairs, boarding points and base fares."
        action={
          <button
            className="primary-button"
            type="button"
            onClick={() => setEditing("new")}
          >
            <Plus size={16} /> Add route
          </button>
        }
      />
      <section className="surface data-surface">
        <DataToolbar
          tabs={["Active routes", "Paused"]}
          active={filter}
          onTab={(tab) => setFilter(tab as "Active routes" | "Paused")}
          search={search}
          onSearch={setSearch}
          placeholder="Search a city or route"
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Route</th>
                <th>Distance</th>
                <th>Travel time</th>
                <th>Base fare</th>
                <th>Boarding point</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleRoutes.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{routeLabel(r)}</strong>
                    <small>Route ID · {r.id.toUpperCase()}</small>
                  </td>
                  <td>
                    <strong>{r.distance}</strong>
                  </td>
                  <td>
                    <strong>{r.duration}</strong>
                  </td>
                  <td>
                    <strong>{money(r.fare)}</strong>
                    <small>Per seat</small>
                  </td>
                  <td>
                    <strong>{r.boarding}</strong>
                  </td>
                  <td>
                    <b className={`plain-status ${r.status.toLowerCase()}`}>
                      {r.status}
                    </b>
                  </td>
                  <td className="record-actions">
                    <button
                      className="text-action"
                      type="button"
                      onClick={() => setEditing(r)}
                    >
                      Edit
                    </button>
                    <button
                      className="icon-action danger"
                      type="button"
                      title="Delete route"
                      aria-label={`Delete ${routeLabel(r)}`}
                      onClick={() => setDeleting(r)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing && (
        <RouteFormModal
          route={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(route) => {
            onSave(route);
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDeleteModal
          title="Delete route?"
          item={routeLabel(deleting)}
          text="A route used by a trip cannot be deleted until that trip is reassigned or removed."
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await onDelete(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

function FinanceProtected({
  unlocked,
  onUnlocked,
  children,
}: {
  unlocked: boolean;
  onUnlocked: () => void;
  children: React.ReactNode;
}) {
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(!unlocked);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (unlocked) return;
    api.financeStatus()
      .then((result) => {
        if (result.unlocked) onUnlocked();
      })
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, [onUnlocked, unlocked]);
  if (unlocked) return <>{children}</>;
  return (
    <div className="finance-lock-page">
      <div className="finance-blur-preview" aria-hidden="true">
        <div /><div /><div /><div />
      </div>
      <form
        className="finance-unlock-card"
        onSubmit={async (event) => {
          event.preventDefault();
          setSubmitting(true);
          setError("");
          try {
            await api.unlockFinance(password);
            onUnlocked();
          } catch (unlockError) {
            setError(unlockError instanceof Error ? unlockError.message : "Finance could not be unlocked.");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <span className="finance-lock-icon"><LockKeyhole size={25} /></span>
        <h1>Finance is locked</h1>
        <p>Enter the main administrator password. Access remains unlocked for 15 minutes.</p>
        <label>
          <span>Administrator password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            disabled={checking || submitting}
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" type="submit" disabled={checking || submitting}>
          <KeyRound size={16} /> {checking ? "Checking…" : submitting ? "Unlocking…" : "Unlock finance"}
        </button>
      </form>
    </div>
  );
}

function ConfirmDeleteModal({
  title,
  text,
  item,
  onClose,
  onConfirm,
}: {
  title: string;
  text: string;
  item: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const confirm = async () => {
    setDeleting(true);
    setError("");
    try {
      await onConfirm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This record could not be deleted.");
      setDeleting(false);
    }
  };
  return (
    <div className="form-modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="form-modal compact-modal delete-modal">
        <header>
          <div><h2>{title}</h2><p>{item}</p></div>
          <button type="button" aria-label="Close" onClick={onClose}><X size={19} /></button>
        </header>
        <div className="delete-modal-body">
          <span><Trash2 size={21} /></span>
          <div><strong>This action cannot be undone.</strong><p>{text}</p></div>
        </div>
        {error && <p className="form-error delete-error">{error}</p>}
        <footer>
          <button className="secondary-button" type="button" onClick={onClose} disabled={deleting}>Cancel</button>
          <button className="danger-button" type="button" onClick={() => void confirm()} disabled={deleting}>
            <Trash2 size={16} /> {deleting ? "Deleting…" : "Delete"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ExpensesView({ showToast }: { showToast: (message: string) => void }) {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({
    date: today,
    category: "Terminal",
    description: "",
    amount: 0,
    paymentMethod: "Cash" as ExpenseRecord["paymentMethod"],
    reference: "",
    notes: "",
  });
  useEffect(() => {
    api.listExpenses<ExpenseRecord>()
      .then((result) => setExpenses(result.expenses))
      .catch((error: unknown) => showToast(error instanceof Error ? error.message : "Expenses could not be loaded."))
      .finally(() => setLoading(false));
  }, [showToast]);
  const updateDraft = (key: keyof typeof draft, value: string | number) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="admin-view expenses-view">
      <ViewHeading eyebrow="ADMIN ONLY" title="Expenses" text="Record day-to-day operating costs with a clear audit trail." />
      <section className="surface expense-entry">
        <SurfaceHeader title="Add expense" text="Record operating costs with the correct payment method and reference." />
        <form
          className="expense-form"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              const result = await api.createExpense<ExpenseRecord>(draft);
              setExpenses((current) => [result.expense, ...current]);
              setDraft((current) => ({ ...current, description: "", amount: 0, reference: "", notes: "" }));
              showToast("Expense saved.");
            } catch (error) {
              showToast(error instanceof Error ? error.message : "Expense could not be saved.");
            }
          }}
        >
          <label><span>Date</span><input type="date" value={draft.date} onChange={(e) => updateDraft("date", e.target.value)} required /></label>
          <label><span>Category</span><select value={draft.category} onChange={(e) => updateDraft("category", e.target.value)}>{["Terminal", "Fuel", "Maintenance", "Driver advance", "Refreshment", "Utilities", "Salary", "Other"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="span-2"><span>Description</span><input value={draft.description} onChange={(e) => updateDraft("description", e.target.value)} placeholder="What was this expense for?" required /></label>
          <label><span>Amount</span><input type="number" min="0.01" step="0.01" value={draft.amount} onChange={(e) => updateDraft("amount", Number(e.target.value))} required /></label>
          <label><span>Paid by</span><select value={draft.paymentMethod} onChange={(e) => updateDraft("paymentMethod", e.target.value)}><option>Cash</option><option>Card</option><option>Bank transfer</option></select></label>
          <label><span>Reference</span><input value={draft.reference} onChange={(e) => updateDraft("reference", e.target.value)} placeholder={draft.paymentMethod === "Cash" ? "Optional" : "Required"} /></label>
          <label><span>Notes</span><input value={draft.notes} onChange={(e) => updateDraft("notes", e.target.value)} placeholder="Optional" /></label>
          <button className="primary-button" type="submit"><Plus size={16} /> Save expense</button>
        </form>
      </section>
      <section className="surface data-surface">
        <SurfaceHeader title="Expense history" text="Latest recorded operating costs" />
        {loading ? <p className="table-loading">Loading expenses…</p> : (
          <div className="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Method</th><th>Amount</th><th>Recorded by</th></tr></thead><tbody>
            {expenses.length ? expenses.map((expense) => <tr key={expense.id}><td>{expense.date}</td><td>{expense.category}</td><td><strong>{expense.description}</strong><small>{expense.reference || expense.notes || "—"}</small></td><td>{expense.paymentMethod}</td><td><strong>{money(expense.amount)}</strong></td><td>{expense.createdBy}</td></tr>) : <tr><td colSpan={6}><EmptyState title="No expenses recorded" text="Use the form above to add the first expense." /></td></tr>}
          </tbody></table></div>
        )}
      </section>
    </div>
  );
}

function FinanceView({ bookings }: { bookings: Booking[] }) {
  const [period, setPeriod] = useState<"7 days" | "30 days">("7 days");
  const settled = bookings.filter((booking) => booking.paid > 0);
  const refunds = settled.flatMap((booking) =>
    (booking.refunds ?? []).map((refund) => ({ booking, refund })),
  );
  const gross = settled.reduce((sum, booking) => sum + booking.paid, 0);
  const refundTotal = refunds.reduce(
    (sum, item) => sum + item.refund.amount,
    0,
  );
  const total = Math.max(0, gross - refundTotal);
  const byMethod = (method: PaymentMethod) => {
    const collected = settled
      .filter((booking) => booking.paymentMethod === method)
      .reduce((sum, booking) => sum + booking.paid, 0);
    const returned = refunds
      .filter((item) => item.refund.method === method)
      .reduce((sum, item) => sum + item.refund.amount, 0);
    return collected - returned;
  };
  const oneBill = byMethod("1Bill");
  const chartDays = period === "7 days" ? 7 : 30;
  const bucketDays = period === "7 days" ? 1 : 3;
  const bucketCount = Math.ceil(chartDays / bucketDays);
  const chartPoints = Array.from({ length: bucketCount }, (_, index) => {
    const endOffset = (bucketCount - index - 1) * bucketDays;
    const dates = Array.from({ length: bucketDays }, (__, dayIndex) => {
      const date = new Date(`${today}T12:00:00`);
      date.setDate(date.getDate() - endOffset - dayIndex);
      return dateInPakistan(date);
    });
    const collected = settled
      .filter((booking) => dates.includes(booking.date))
      .reduce((sum, booking) => sum + booking.paid, 0);
    const returned = refunds
      .filter((item) => dates.includes(dateInPakistan(item.refund.processedAt)))
      .reduce((sum, item) => sum + item.refund.amount, 0);
    const labelDate = new Date(`${dates[0]}T12:00:00`);
    return {
      label:
        period === "7 days"
          ? labelDate.toLocaleDateString("en-PK", { weekday: "short" })
          : labelDate.toLocaleDateString("en-PK", {
              day: "numeric",
              month: "short",
            }),
      value: Math.max(0, collected - returned),
    };
  });
  const chartMaximum = Math.max(1, ...chartPoints.map((point) => point.value));
  return (
    <div className="admin-view">
      <ViewHeading
        eyebrow="COLLECTIONS & SETTLEMENTS"
        title="Finance"
        text="Gross sales, traceable refunds, payment channels and daily reconciliation."
        action={
          <div className="view-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                downloadCsv("madina-finance-ledger.csv", [
                  [
                    "Type",
                    "Ticket",
                    "Passenger",
                    "Payment method",
                    "Reference",
                    "Amount",
                    "Reason",
                    "Date",
                    "Time",
                    "Processed by",
                  ],
                  ...settled.map((booking) => [
                    "Sale",
                    booking.ticketNo,
                    booking.passenger,
                    booking.paymentMethod,
                    booking.paymentReference,
                    booking.paid,
                    "",
                    booking.date,
                    booking.time,
                    booking.issuedBy ?? "Online",
                  ]),
                  ...refunds.map(({ booking, refund }) => [
                    "Refund",
                    booking.ticketNo,
                    booking.passenger,
                    refund.method,
                    refund.reference,
                    -refund.amount,
                    refund.reason,
                    dateInPakistan(refund.processedAt),
                    new Date(refund.processedAt).toLocaleTimeString("en-PK", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                    refund.processedBy,
                  ]),
                ])
              }
            >
              <FileBarChart size={16} /> Export
            </button>
          </div>
        }
      />
      <section className="metric-grid finance-metrics">
        {[
          {
            l: "Gross sales",
            v: money(gross),
            n: `${settled.length} paid bookings before refunds`,
            i: Banknote,
            t: "green",
          },
          {
            l: "1Bill collections",
            v: money(oneBill),
            n: "Net of 1Bill refunds",
            i: CreditCard,
            t: "gold",
          },
          {
            l: "Counter collections",
            v: money(total - oneBill),
            n: "Net cash, card and bank",
            i: WalletCards,
            t: "blue",
          },
          {
            l: "Refunds",
            v: money(refundTotal),
            n: refunds.length
              ? `${refunds.length} recorded refund${refunds.length === 1 ? "" : "s"}`
              : "No refunds recorded",
            i: RefreshCw,
            t: "orange",
          },
        ].map((m) => {
          const Icon = m.i;
          return (
            <article className="metric-card" key={m.l}>
              <span className={`metric-icon ${m.t}`}>
                <Icon size={19} />
              </span>
              <div>
                <small>{m.l}</small>
                <strong>{m.v}</strong>
                <p>{m.n}</p>
              </div>
            </article>
          );
        })}
      </section>
      <div className="finance-grid">
        <section className="surface finance-chart">
          <SurfaceHeader
            title={
              period === "7 days" ? "Seven-day collections" : "Thirty-day trend"
            }
            text="Net collections after refunds"
            action={
              <div className="mini-tabs">
                {(["7 days", "30 days"] as const).map((item) => (
                  <button
                    type="button"
                    className={period === item ? "active" : ""}
                    onClick={() => setPeriod(item)}
                    key={item}
                  >
                    {item}
                  </button>
                ))}
              </div>
            }
          />
          <div
            className="bar-chart"
            style={{ gridTemplateColumns: `repeat(${chartPoints.length}, 1fr)` }}
          >
            {chartPoints.map((point) => (
              <div key={point.label} title={money(point.value)}>
                <span>
                  <i
                    style={{
                      height: `${point.value ? Math.max(5, Math.round((point.value / chartMaximum) * 100)) : 0}%`,
                    }}
                  />
                </span>
                <small>{point.label}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="surface payment-breakdown">
          <SurfaceHeader
            title="Payment breakdown"
            text="Share of collected revenue"
          />
          {(["Cash", "1Bill", "Card", "Bank transfer"] as PaymentMethod[]).map(
            (m) => {
              const amount = byMethod(m),
                pct = total
                  ? Math.max(0, Math.min(100, Math.round((amount / total) * 100)))
                  : 0;
              return (
                <div className="breakdown-row" key={m}>
                  <span
                    className={`method-dot ${m.toLowerCase().replace(" ", "-")}`}
                  />
                  <div>
                    <span>
                      <strong>{m}</strong>
                      <small>{money(amount)}</small>
                    </span>
                    <i>
                      <em style={{ width: `${pct}%` }} />
                    </i>
                  </div>
                  <b>{pct}%</b>
                </div>
              );
            },
          )}
          <SettlementNote
            title="Refunds included"
            text="Each method shows collections minus refunds paid through that method."
          />
        </section>
      </div>
      <section className="surface data-surface finance-ledger">
        <SurfaceHeader
          title="Transaction ledger"
          text="Latest paid bookings with their refund status"
        />
        <BookingTable
          bookings={settled.slice(0, 6)}
          onPrint={() => undefined}
          compact
        />
      </section>
      <section className="surface data-surface refund-register">
        <SurfaceHeader
          title="Refund register"
          text="Amount, reason, reference and staff member for every refund"
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Passenger</th>
                <th>Refund</th>
                <th>Method / reference</th>
                <th>Reason</th>
                <th>Processed</th>
              </tr>
            </thead>
            <tbody>
              {refunds.length ? (
                [...refunds]
                  .sort(
                    (a, b) =>
                      new Date(b.refund.processedAt).getTime() -
                      new Date(a.refund.processedAt).getTime(),
                  )
                  .map(({ booking, refund }) => (
                    <tr key={refund.id}>
                      <td>
                        <strong>{booking.ticketNo}</strong>
                        <small>{booking.route}</small>
                      </td>
                      <td>
                        <strong>{booking.passenger}</strong>
                        <small>{booking.phone}</small>
                      </td>
                      <td>
                        <strong>{money(refund.amount)}</strong>
                        <small>{booking.paymentStatus}</small>
                      </td>
                      <td>
                        <strong>{refund.method}</strong>
                        <small>{refund.reference}</small>
                      </td>
                      <td>
                        <strong>{refund.reason}</strong>
                        <small>{refund.notes || "No additional notes"}</small>
                      </td>
                      <td>
                        <strong>{formatPrintTime(refund.processedAt)}</strong>
                        <small>{refund.processedBy}</small>
                      </td>
                    </tr>
                  ))
              ) : (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      title="No refunds recorded"
                      text="Refunds issued from Bookings will appear here."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function CrewFormModal({
  person,
  onClose,
  onSave,
}: {
  person?: CrewRecord;
  onClose: () => void;
  onSave: (person: CrewRecord, previousName?: string) => void;
}) {
  const [draft, setDraft] = useState<CrewRecord>(
    person ?? {
      name: "",
      role: "Driver",
      phone: "",
      cnic: "",
      license: "",
      duty: "Available at terminal",
      status: "Available",
      initials: "",
    },
  );
  const update = <K extends keyof CrewRecord>(key: K, value: CrewRecord[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div
      className="form-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={person ? "Edit staff member" : "Add staff member"}
    >
      <form
        className="form-modal compact-modal"
        onSubmit={(event) => {
          event.preventDefault();
          const initials = draft.name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((word) => word[0])
            .join("")
            .toUpperCase();
          onSave(
            {
              ...draft,
              initials: initials || "ME",
              license: draft.role === "Driver" ? draft.license : "—",
            },
            person?.name,
          );
        }}
      >
        <header>
          <div>
            <h2>{person ? "Edit staff member" : "Add staff member"}</h2>
            <p>Identity, role and current terminal assignment.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <div className="modal-form-grid">
          <label className="span-2">
            <span>Full name *</span>
            <input
              required
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
            />
          </label>
          <label>
            <span>Role</span>
            <select
              value={draft.role}
              onChange={(event) =>
                update("role", event.target.value as CrewRecord["role"])
              }
            >
              <option>Driver</option>
              <option>Female attendant</option>
              <option>Manager</option>
              <option>Counter agent</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              value={draft.status}
              onChange={(event) =>
                update("status", event.target.value as CrewRecord["status"])
              }
            >
              <option>Available</option>
              <option>Scheduled</option>
              <option>On duty</option>
              <option>Off duty</option>
            </select>
          </label>
          <label>
            <span>Mobile number *</span>
            <input
              required
              value={draft.phone}
              onChange={(event) => update("phone", event.target.value)}
              placeholder="03XX XXXXXXX"
            />
          </label>
          <label>
            <span>CNIC number *</span>
            <input
              required
              value={draft.cnic}
              onChange={(event) => update("cnic", event.target.value)}
              placeholder="XXXXX-XXXXXXX-X"
            />
          </label>
          {draft.role === "Driver" && (
            <label className="span-2">
              <span>HTV license number *</span>
              <input
                required
                value={draft.license}
                onChange={(event) => update("license", event.target.value)}
              />
            </label>
          )}
          <label className="span-2">
            <span>Current assignment</span>
            <input
              value={draft.duty}
              onChange={(event) => update("duty", event.target.value)}
            />
          </label>
        </div>
        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            <Check size={16} /> Save staff member
          </button>
        </footer>
      </form>
    </div>
  );
}

function CrewView({
  crew,
  onSave,
  onDelete,
}: {
  crew: CrewRecord[];
  onSave: (person: CrewRecord, previousName?: string) => void;
  onDelete: (id: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState<CrewRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<CrewRecord | null>(null);
  const [filter, setFilter] = useState("All staff");
  const [search, setSearch] = useState("");
  const visibleCrew = crew.filter(
    (person) =>
      (filter === "All staff" ||
        (filter === "Drivers"
          ? person.role === "Driver"
          : person.role === "Female attendant")) &&
      `${person.name} ${person.phone} ${person.cnic} ${person.duty}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="admin-view">
      <ViewHeading
        eyebrow="PEOPLE"
        title="Staff & crew"
        text="Drivers, female attendants and current duty assignments."
        action={
          <button
            className="primary-button"
            type="button"
            onClick={() => setEditing("new")}
          >
            <Plus size={16} /> Add staff member
          </button>
        }
      />
      <section className="surface data-surface">
        <DataToolbar
          tabs={["All staff", "Drivers", "Female attendants"]}
          active={filter}
          onTab={setFilter}
          search={search}
          onSearch={setSearch}
          placeholder="Search staff member"
        />
        <div className="crew-grid">
          {visibleCrew.map((m) => (
            <article key={m.name}>
              <span className="crew-avatar">{m.initials}</span>
              <div>
                <strong>{m.name}</strong>
                <small>{m.role}</small>
                <p>{m.phone}</p>
                <p>{m.cnic}</p>
              </div>
              <div className="crew-duty">
                <small>Current assignment</small>
                <strong>{m.duty}</strong>
              </div>
              <b
                className={`plain-status ${m.status.toLowerCase().replace(" ", "-")}`}
              >
                {m.status}
              </b>
              <div className="record-actions">
                <button
                  className="icon-action"
                  type="button"
                  title="Edit staff member"
                  aria-label={`Edit ${m.name}`}
                  onClick={() => setEditing(m)}
                >
                  <ChevronRight size={16} />
                </button>
                <button
                  className="icon-action danger"
                  type="button"
                  title="Delete staff member"
                  aria-label={`Delete ${m.name}`}
                  onClick={() => setDeleting(m)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      {editing && (
        <CrewFormModal
          person={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(person, previousName) => {
            onSave(person, previousName);
            setEditing(null);
          }}
        />
      )}
      {deleting && deleting.id && (
        <ConfirmDeleteModal
          title="Delete staff member?"
          item={deleting.name}
          text="Staff assigned to an active trip must be reassigned before deletion."
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await onDelete(deleting.id!);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

function SettingsView({
  user,
  onUserChange,
  paymentMode,
  staffUsers,
  onUserCreated,
  showToast,
}: {
  user: StaffUser;
  onUserChange: (user: StaffUser) => void;
  paymentMode: string;
  staffUsers: StaffUser[];
  onUserCreated: (user: StaffUser) => void;
  showToast: (message: string) => void;
}) {
  const [sampleReceipt, setSampleReceipt] = useState(false),
    [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [savingPassword, setSavingPassword] = useState(false),
    [newStaff, setNewStaff] = useState({
      name: "",
      email: "",
      username: "",
      role: "counter" as StaffUser["role"],
      password: "",
    }),
    [creatingStaff, setCreatingStaff] = useState(false);
  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      showToast("The new passwords do not match.");
      return;
    }
    setSavingPassword(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onUserChange({ ...user, forcePasswordChange: false });
      showToast("Password changed successfully.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Password change failed.");
    } finally {
      setSavingPassword(false);
    }
  };
  const createStaff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreatingStaff(true);
    try {
      const result = await api.createUser<StaffUser>(newStaff);
      onUserCreated(result.user);
      setNewStaff({ name: "", email: "", username: "", role: "counter", password: "" });
      showToast(`${result.user.name} can now sign in.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Staff account could not be created.");
    } finally {
      setCreatingStaff(false);
    }
  };
  return (
    <div className="admin-view">
      <ViewHeading
        eyebrow="CONFIGURATION"
        title="System settings"
        text="Security, payment readiness, ticketing rules and system status."
      />
      <div className="settings-grid">
        <section className="surface settings-card">
          <SettingsTitle
            icon={<CreditCard size={19} />}
            title="1Bill payment gateway"
            text="Controls the public website payment experience."
            status={paymentMode !== "disabled"}
          />
          <div className="settings-fields">
            <label>
              <span>Gateway status</span>
              <input value={paymentMode === "demo" ? "Demo adapter" : paymentMode === "disabled" ? "Not configured" : "Production"} readOnly />
            </label>
            <label>
              <span>Payment environment</span>
              <input value={paymentMode} readOnly />
            </label>
            <label className="span-2">
              <span>Callback URL</span>
              <input
                value="Configured on the secured backend"
                readOnly
              />
            </label>
          </div>
          <div className="policy-box">
            <ShieldCheck size={17} />
            <span>
              <strong>{paymentMode === "demo" ? "Demonstration payments only" : "Server-controlled payment mode"}</strong>
              <small>{paymentMode === "demo" ? "No real money is collected until authorized 1Bill merchant credentials are installed." : "Payment secrets are never exposed in this browser."}</small>
            </span>
          </div>
        </section>
        {user.role === "admin" && (
          <section className="surface settings-card">
            <SettingsTitle
              icon={<UsersRound size={19} />}
              title="Staff access"
              text={`${staffUsers.length} sign-in account${staffUsers.length === 1 ? "" : "s"}`}
              status
            />
            <form className="settings-fields" onSubmit={createStaff}>
              <label>
                <span>Full name</span>
                <input required value={newStaff.name} onChange={(event) => setNewStaff({ ...newStaff, name: event.target.value })} />
              </label>
              <label>
                <span>Email</span>
                <input type="email" required value={newStaff.email} onChange={(event) => setNewStaff({ ...newStaff, email: event.target.value })} />
              </label>
              <label>
                <span>Username</span>
                <input required value={newStaff.username} onChange={(event) => setNewStaff({ ...newStaff, username: event.target.value })} />
              </label>
              <label>
                <span>Role</span>
                <select value={newStaff.role} onChange={(event) => setNewStaff({ ...newStaff, role: event.target.value as StaffUser["role"] })}>
                  <option value="manager">Manager</option>
                  <option value="counter">Counter agent</option>
                  <option value="dispatcher">Dispatcher</option>
                  <option value="finance">Finance</option>
                  <option value="admin">Administrator</option>
                </select>
              </label>
              <label className="span-2">
                <span>Temporary password</span>
                <input type="password" minLength={12} required value={newStaff.password} onChange={(event) => setNewStaff({ ...newStaff, password: event.target.value })} />
              </label>
              <button className="primary-button span-2" type="submit" disabled={creatingStaff}>
                <Plus size={15} /> {creatingStaff ? "Creating…" : "Create staff account"}
              </button>
            </form>
            <div className="integration-list">
              {staffUsers.slice(0, 5).map((account) => (
                <span key={account.id}>
                  <i /> {account.name} <b>{account.role}</b>
                </span>
              ))}
            </div>
          </section>
        )}
        <section className="surface settings-card">
          <SettingsTitle
            icon={<Ticket size={19} />}
            title="Ticket & reservation policy"
            text="Rules applied at the counter and public website."
          />
          <div className="policy-box">
            <ShieldCheck size={17} />
            <span>
              <strong>Public payment rule</strong>
              <small>
                Online reservations hold seats until an operator collects payment or cancels them. Online payment will be enabled after 1Bill setup.
              </small>
            </span>
          </div>
          <div className="policy-box refund-policy-box">
            <RefreshCw size={17} />
            <span>
              <strong>Refund control</strong>
              <small>
                Staff must record an amount, reason, method and reference. A
                full refund releases the seats. For a partial refund, choose whether to cancel the
                ticket or keep it confirmed. No automatic cancellation fee is applied.
              </small>
            </span>
          </div>
        </section>
        <section className="surface settings-card">
          <SettingsTitle
            icon={<LockKeyhole size={19} />}
            title="Account security"
            text={`${user.name} · ${user.role}`}
            status={!user.forcePasswordChange}
          />
          {user.forcePasswordChange && (
            <p className="form-error">
              Change the temporary password before operational use.
            </p>
          )}
          <form className="settings-fields" onSubmit={changePassword}>
            <label className="span-2">
              <span>Current password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              <span>New password</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              <span>Confirm new password</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            <button
              className="primary-button span-2"
              type="submit"
              disabled={savingPassword}
            >
              <KeyRound size={15} />
              {savingPassword ? "Changing…" : "Change password"}
            </button>
          </form>
        </section>
        <section className="surface settings-card">
          <SettingsTitle
            icon={<ReceiptText size={19} />}
            title="Receipt configuration"
            text="Thermal ticket and passenger contact details."
          />
          <div className="settings-fields">
            <label>
              <span>Business name</span>
              <input value="Madina Express" readOnly />
            </label>
            <label>
              <span>Support number</span>
              <input value="0311-777-2299" readOnly />
            </label>
            <label className="span-2">
              <span>Terminal address</span>
              <input value="Madina Terminal, Peshawar" readOnly />
            </label>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setSampleReceipt(true)}
          >
            <Printer size={15} /> Print sample
          </button>
        </section>
        <section className="surface settings-card">
          <SettingsTitle
            icon={<ShieldCheck size={19} />}
            title="Data & deployment"
            text="Where operational records are stored."
          />
          <div className="data-status">
            <span className="status-ring">
              <Check size={18} />
            </span>
            <div>
              <strong>MySQL operational database connected</strong>
              <p>
                Bookings, refunds, vehicles, routes, trips, staff, finance and
                audit events are shared through the secured backend.
              </p>
            </div>
          </div>
          <div className="integration-list">
            <span>
              <i /> MySQL / MariaDB <b>Connected</b>
            </span>
            <span>
              <i /> Automated backups <b>Script ready</b>
            </span>
            <span>
              <i /> Role permissions <b>Enabled</b>
            </span>
          </div>
        </section>
      </div>
      {sampleReceipt && (
        <ReceiptModal
          booking={initialBookings[0]}
          onClose={() => setSampleReceipt(false)}
        />
      )}
    </div>
  );
}

function SettingsTitle({
  icon,
  title,
  text,
  status = false,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  status?: boolean;
}) {
  return (
    <div className="settings-title">
      <span>{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      {status && <b className="plain-status active">Configured</b>}
    </div>
  );
}
function DataToolbar({
  tabs,
  active,
  onTab,
  search,
  onSearch,
  placeholder,
}: {
  tabs: string[];
  active: string;
  onTab: (tab: string) => void;
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="data-toolbar">
      <div className="filter-tabs">
        {tabs.map((tab) => (
          <button
            type="button"
            className={active === tab ? "active" : ""}
            onClick={() => onTab(tab)}
            key={tab}
          >
            {tab}
          </button>
        ))}
      </div>
      <label className="search-box">
        <Search size={16} />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder}
        />
      </label>
    </div>
  );
}

function BookingTable({
  bookings,
  onPrint,
  onCancel,
  onEdit,
  onRefund,
  compact = false,
}: {
  bookings: Booking[];
  onPrint: (booking: Booking) => void;
  onCancel?: (id: string) => void;
  onEdit?: (booking: Booking) => void;
  onRefund?: (booking: Booking) => void;
  compact?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className={compact ? "compact-table" : ""}>
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Passenger</th>
            <th>Journey</th>
            <th>Seats</th>
            <th>Channel</th>
            <th>Amount</th>
            <th>Status</th>
            {!compact && <th />}
          </tr>
        </thead>
        <tbody>
          {bookings.length ? (
            bookings.map((b) => (
              <tr
                className={
                  ["Cancelled", "Refunded"].includes(b.bookingStatus)
                    ? "cancelled-row"
                    : ""
                }
                key={b.id}
              >
                <td>
                  <strong>{b.ticketNo}</strong>
                  <small>
                    {b.date} · {b.time}
                  </small>
                </td>
                <td>
                  <strong>{b.passenger}</strong>
                  <small>{b.phone}</small>
                </td>
                <td>
                  <strong>{b.route}</strong>
                  <small>
                    {b.bus} · {b.service}
                  </small>
                </td>
                <td>
                  <span className="seat-list">{b.seats.join(", ")}</span>
                </td>
                <td>
                  <strong>{b.source}</strong>
                  <small>
                    {b.paymentMethod}
                    {b.paymentReference ? ` · ${b.paymentReference}` : ""}
                  </small>
                </td>
                <td>
                  <strong>{money(b.paid || b.total)}</strong>
                  <small>
                    {refundedTotal(b)
                      ? `${money(refundedTotal(b))} refunded · ${(b.refunds ?? []).at(-1)?.reason}${(b.refunds ?? []).at(-1)?.notes ? ` · ${(b.refunds ?? []).at(-1)?.notes}` : ""}`
                      : b.paymentStatus}
                  </small>
                </td>
                <td>
                  <span
                    className={`status-badge ${b.bookingStatus.toLowerCase()}`}
                  >
                    {b.bookingStatus}
                  </span>
                </td>
                {!compact && (
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        title="Print ticket"
                        aria-label={`Print ${b.ticketNo}`}
                        onClick={() => onPrint(b)}
                      >
                        <Printer size={15} />
                      </button>
                      {onEdit && (
                        <button
                          type="button"
                          title="Edit passenger details"
                          aria-label={`Edit ${b.ticketNo}`}
                          disabled={["Cancelled", "Refunded"].includes(
                            b.bookingStatus,
                          )}
                          onClick={() => onEdit(b)}
                        >
                          <FileText size={15} />
                        </button>
                      )}
                      {onRefund && (
                        <button
                          type="button"
                          title="Issue refund"
                          aria-label={`Refund ${b.ticketNo}`}
                          disabled={
                            refundableBalance(b) <= 0 ||
                            b.bookingStatus === "Reserved"
                          }
                          onClick={() => onRefund(b)}
                        >
                          <RefreshCw size={15} />
                        </button>
                      )}
                      {onCancel && (
                        <button
                          type="button"
                          title="Cancel booking"
                          aria-label={`Cancel ${b.ticketNo}`}
                          disabled={["Cancelled", "Refunded"].includes(
                            b.bookingStatus,
                          )}
                          onClick={() => onCancel(b.id)}
                        >
                          <XCircle size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={compact ? 7 : 8}>
                <EmptyState
                  title="No records found"
                  text="Try changing your search or filter."
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SeatMap({
  seats,
  selectedSeats,
  occupied,
  onSelect,
  large = false,
}: {
  seats: number;
  selectedSeats: number[];
  occupied: Set<number>;
  onSelect: (seat: number) => void;
  large?: boolean;
}) {
  return (
    <div className={`seat-map-wrap ${large ? "large" : ""}`}>
      <div className="legend">
        <span>
          <i className="available" />
          Available
        </span>
        <span>
          <i className="selected" />
          Selected
        </span>
        <span>
          <i className="booked" />
          Occupied
        </span>
      </div>
      <div className="bus-shell">
        <div className="bus-front">
          <span>
            <BusFront size={17} /> FRONT
          </span>
          <span>DRIVER</span>
        </div>
        <div className="seat-layout">
          {Array.from({ length: Math.ceil(seats / 4) }, (_, rowIndex) => {
            const rowSeats = Array.from(
              { length: 4 },
              (__, i) => rowIndex * 4 + i + 1,
            ).filter((s) => s <= seats);
            return (
              <div className="seat-row" key={rowIndex}>
                <div className="seat-pair">
                  {rowSeats.slice(0, 2).map((s) => (
                    <SeatButton
                      seat={s}
                      selected={selectedSeats.includes(s)}
                      occupied={occupied.has(s)}
                      onSelect={onSelect}
                      key={s}
                    />
                  ))}
                </div>
                <span className="aisle">{rowIndex + 1}</span>
                <div className="seat-pair">
                  {rowSeats.slice(2, 4).map((s) => (
                    <SeatButton
                      seat={s}
                      selected={selectedSeats.includes(s)}
                      occupied={occupied.has(s)}
                      onSelect={onSelect}
                      key={s}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
function SeatButton({
  seat,
  selected,
  occupied,
  onSelect,
}: {
  seat: number;
  selected: boolean;
  occupied: boolean;
  onSelect: (seat: number) => void;
}) {
  const status = occupied ? "booked" : selected ? "selected" : "available";
  return (
    <button
      type="button"
      disabled={occupied}
      className={`seat seat--${status}`}
      aria-label={`Seat ${seat}, ${status}`}
      aria-pressed={selected}
      onClick={() => onSelect(seat)}
    >
      <Armchair size={15} />
      <b>{seat}</b>
    </button>
  );
}
function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <FileText size={24} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function ReceiptModal({
  booking,
  onClose,
}: {
  booking: Booking;
  onClose: () => void;
}) {
  return (
    <div
      className="receipt-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Ticket ${booking.ticketNo}`}
    >
      <div className="receipt-modal">
        <div className="receipt-toolbar">
          <div>
            <strong>
              {booking.bookingStatus === "Reserved"
                ? "Reservation slip"
                : booking.bookingStatus === "Refunded"
                  ? "Refunded ticket"
                  : booking.bookingStatus === "Cancelled" ? "Cancelled ticket" : "Confirmed ticket"}
            </strong>
            <small>80mm thermal receipt</small>
          </div>
          <button type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <article className="receipt">
          <header>
            <div className="receipt-logo">ME</div>
            <h2>MADINA EXPRESS</h2>
            <p>Travel with confidence</p>
            <small>0311-777-2299 · Madina Terminal, Peshawar</small>
          </header>
          <div className="receipt-rule" />
          <div className="ticket-heading">
            <span>
              <small>
                {booking.bookingStatus === "Reserved"
                  ? "RESERVATION NO."
                  : "TICKET NO."}
              </small>
              <strong>{booking.ticketNo}</strong>
            </span>
            <span
              className={`receipt-status ${booking.paymentStatus.toLowerCase().replaceAll(" ", "-")}`}
            >
              {booking.paymentStatus}
            </span>
          </div>
          <div className="receipt-route">
            <span>{booking.route.split(" → ")[0]}</span>
            <i>→</i>
            <span>{booking.destination}</span>
          </div>
          <div className="receipt-grid">
            <span>
              <small>Departure</small>
              <strong>
                {booking.date}
                <br />
                {booking.time}
              </strong>
            </span>
            <span>
              <small>Bus / Service</small>
              <strong>
                {booking.bus}
                <br />
                {booking.service}
              </strong>
            </span>
            <span>
              <small>Passenger</small>
              <strong>{booking.passenger}</strong>
            </span>
            <span>
              <small>Seat number</small>
              <strong className="large-seat">{booking.seats.join(", ")}</strong>
            </span>
            <span>
              <small>Boarding point</small>
              <strong>{booking.boardingPoint}</strong>
            </span>
            <span>
              <small>Female attendant</small>
              <strong>{booking.attendant}</strong>
            </span>
          </div>
          <div className="receipt-rule" />
          <div className="receipt-line">
            <span>Fare</span>
            <strong>{money(booking.fare * booking.seats.length)}</strong>
          </div>
          <div className="receipt-line">
            <span>Discount</span>
            <strong>- {money(booking.discount)}</strong>
          </div>
          <div className="receipt-line total-line">
            <span>Total</span>
            <strong>{money(booking.total)}</strong>
          </div>
          <div className="receipt-line">
            <span>
              {booking.paymentStatus === "Unpaid"
                ? "Amount due"
                : `Net paid via ${booking.paymentMethod}`}
            </span>
            <strong>
              {booking.paymentStatus === "Unpaid"
                ? money(booking.balance)
                : money(netCollected(booking))}
            </strong>
          </div>
          {booking.paymentReference && (
            <div className="receipt-line">
              <span>Payment reference</span>
              <strong>{booking.paymentReference}</strong>
            </div>
          )}
          {refundedTotal(booking) > 0 && (
            <>
              <div className="receipt-line refund-line">
                <span>Total refunded</span>
                <strong>- {money(refundedTotal(booking))}</strong>
              </div>
              {(booking.refunds ?? []).map((refund) => (
                <div className="receipt-refund" key={refund.id}>
                  <span>
                    {formatPrintTime(refund.processedAt)} · {refund.reason}
                  </span>
                  <strong>
                    {money(refund.amount)} · {refund.method} · {refund.reference}
                  </strong>
                  {refund.notes && <small>{refund.notes}</small>}
                </div>
              ))}
            </>
          )}
          <div className="receipt-barcode">
            <span />
            <small>{booking.ticketNo}</small>
          </div>
          {booking.bookingStatus === "Confirmed" && (
            <div className="boarding-coupon">
              <strong>BOARDING COUPON</strong>
              <span>
                <small>Seat</small>
                <b>{booking.seats.join(", ")}</b>
              </span>
              <span>
                <small>Bus</small>
                <b>{booking.bus}</b>
              </span>
              <span>
                <small>Time</small>
                <b>{booking.time}</b>
              </span>
            </div>
          )}
          <footer>
            <p>
              {booking.bookingStatus === "Cancelled" ? "CANCELLED · This ticket is no longer valid for boarding." : booking.paymentStatus === "Refunded"
                ? "REFUNDED · This ticket is no longer valid for boarding."
                : booking.paymentStatus === "Partially refunded"
                  ? "PARTIALLY REFUNDED · Ticket remains valid for boarding."
                  : booking.paymentStatus === "Paid"
                    ? "PAID & CONFIRMED · Please arrive 30 minutes before departure."
                    : "UNPAID RESERVATION · Pay at the terminal to confirm."}
            </p>
            <small>
              Terms and conditions apply. Keep this ticket for boarding.
            </small>
          </footer>
        </article>
        <div className="receipt-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Close
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => window.print()}
          >
            <Printer size={16} />{" "}
            {booking.bookingStatus === "Refunded"
              ? "Print refund record"
              : "Print ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
