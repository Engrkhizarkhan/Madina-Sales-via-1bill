import { type FormEvent, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { ticketPresentation, ticketDate, ticketTime } from "./ticket-format";
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
  CreditCard,
  FileBarChart,
  FileText,
  Gauge,
  Headphones,
  KeyRound,
  LockKeyhole,
  LogOut,
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
  UserRoundCog,
  UsersRound,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import "./App.css";
import "./print-documents.css";
import { api, ApiError } from "./api";
import { coachRows, isSleeper, seatLabel, seatList, sleeperRows } from "./seat-layout";

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
  snapshot?: { routeId: string; departure: string; arrival: string; route: RouteRecord; bus: BusRecord; voucher?: Voucher; passengers?: Booking[] };
  departedAt?: string;
  returnedAt?: string;
  notes?: string;
  days: Weekday[];
  active: boolean;
  runNumber: number;
  lastDepartedAt?: string;
};
type Voucher = {
  commissionRate: number; manualCommission: number; refreshments: number; terminalExpense: number;
  toll: number; misc: number; paidToDriver: number; driver: string; attendant: string;
  commission?: number; deductions?: number; basis?: number; revision?: string; savedAt?: string; savedBy?: string;
};
type CounterChanges = {registration: string; departure: string; voucher?: Voucher; expected: {registration: string; departure: string; revision: string}};
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
      onPaid({...result.booking, seats: result.bookings.flatMap(item => item.seats)});
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
              service={trip.bus.service}
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
                      ? seatList(selectedSeats, trip.bus.service)
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
      { id: "sale" as AdminView, label: "Seat booking", icon: Ticket },
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
      new URLSearchParams(location.search).has("trip") && roleViews[user.role].includes("sale") ? "sale" : defaultAdminView(user),
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
    [receiptBatch, setReceiptBatch] = useState<Booking[]>([]),
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
  const saveCounter = async (tripId: string, date: string, draft: CounterChanges) => {
    const result = await api.saveCounterDeparture<TripRun>(tripId, {date, ...draft});
    setRuns(current => [...current.filter(run => run.id !== result.trip.id), result.trip]);
    const updatedBus = result.trip.snapshot!.bus;
    setFleet(current => [...current.filter(bus => bus.id !== updatedBus.id), updatedBus]);
    setBookings(current => current.map(booking => booking.tripRunId === result.trip.id && ["Confirmed","Reserved"].includes(booking.bookingStatus) ? {...booking, bus: updatedBus.registration, service: updatedBus.service, time: result.trip.snapshot!.departure, driver: result.trip.driver, attendant: result.trip.attendant} : booking));
    showToast(draft.voucher ? "Voucher saved. Expenses updated." : "Bus and departure time saved.");
    return result.trip;
  };
  const saveBooking = async (booking: Booking) => {
    try {
      const result = await api.createBooking<Booking>(booking);
      setBookings((current) => [...result.bookings, ...current]);
      if (result.booking.bookingStatus !== "Reserved") { setReceiptBatch(result.bookings); setReceipt(result.booking); }
      showToast(
        result.booking.bookingStatus === "Reserved"
          ? `${result.bookings.length} seat reservation(s) saved. No ticket issued.`
          : `${result.bookings.length} separate ticket(s) issued.`,
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
      throw error;
    }
  };
  const updateBooking = async (updated: Booking) => {
    try {
      const result = await api.updateBooking<Booking>(updated.id, updated);
      setBookings((current) => current.map((item) => item.id === updated.id ? result.booking : item));
      showToast(`${updated.ticketNo} passenger details updated.`);
    } catch (error) {
      failure(error);
      throw error;
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
      setReceiptBatch([]);
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
              onCounterSave={saveCounter}
              onPrint={booking => {setReceiptBatch([]);setReceipt(booking);}}
              onCancel={cancelBooking}
              onConfirm={confirmReservation}
              onRefund={processRefund}
              onUpdate={updateBooking}
              onReport={openReport}
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
              onPrint={booking => {setReceiptBatch([]);setReceipt(booking);}}
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
              onPrintTicket={booking => {setReceiptBatch([]);setReceipt(booking);}}
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
        <ReceiptModal booking={receipt} batch={receiptBatch} onClose={() => {setReceipt(null);setReceiptBatch([]);}} />
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

function BookingWorkspace({bookings,trips,fleet,routes,runs,initialSelection,onSave,showToast,paymentMode,onCounterSave,onPrint,onCancel,onConfirm,onRefund,onUpdate,onReport}: {
  bookings: Booking[]; trips: TripRecord[]; fleet: BusRecord[]; routes: RouteRecord[]; runs: TripRun[];
  initialSelection: {tripId:string;date:string;mode?:"Ticket"|"Reservation"}|null;
  onSave: (booking:Booking)=>Promise<void>; showToast:(message:string)=>void; paymentMode:string;
  onCounterSave:(id:string,date:string,changes:CounterChanges)=>Promise<TripRun>;
  onPrint:(booking:Booking)=>void; onCancel:(id:string)=>Promise<void>;
  onConfirm:(id:string,method:PaymentMethod,reference:string)=>Promise<void>;
  onRefund:(id:string,refund:RefundTransaction)=>Promise<void>; onUpdate:(booking:Booking)=>Promise<void>;
  onReport:(kind:ReportKind,id:string,run:number,date?:string)=>void;
}) {
  const params = new URLSearchParams(location.search);
  const defaultTrip = trips.find(t=>t.id===(initialSelection?.tripId ?? params.get("trip"))) ?? trips.find(t=>t.active) ?? trips[0];
  const [tripId,setTripId] = useState(defaultTrip.id);
  const [date,setDate] = useState(initialSelection?.date ?? params.get("date") ?? today);
  const [routeId,setRouteId] = useState(defaultTrip.routeId);
  const [service,setService] = useState(tripBus(defaultTrip,fleet).service);
  const [mode,setMode] = useState<"Ticket"|"Reservation">(initialSelection?.mode ?? "Ticket");
  const [selected,setSelected] = useState<number[]>([]);
  const [busy,setBusy] = useState(false), [error,setError] = useState("");
  const [focusedId,setFocusedId] = useState<string|null>(null);
  const [action,setAction] = useState<"payment"|"refund"|"edit"|null>(null);
  const [search,setSearch] = useState("");
  const [departureDirty,setDepartureDirty] = useState(false);
  const trip = tripOnDate(trips.find(t=>t.id===tripId) ?? defaultTrip,date,runs);
  const bus = tripBus(trip,fleet), route = tripRoute(trip,routes);
  const runId = tripRunKey(trip,trip.runNumber,date);
  const records = bookings.filter(b=>b.tripRunId===runId);
  const active = records.filter(b=>["Reserved","Confirmed"].includes(b.bookingStatus));
  const occupied = new Set(active.flatMap(b=>b.seats));
  const reserved = new Set(active.filter(b=>b.bookingStatus==="Reserved").flatMap(b=>b.seats));
  const focused = records.find(b=>b.id===focusedId);
  const unavailable = date < today || !trip.active || !trip.days.includes(serviceDayFor(date)) || ["Departed","Returned","Cancelled"].includes(trip.status) || ["Maintenance","Retired"].includes(bus.status);
  const blank = ():PassengerForm=>({passenger:"",phone:"",cnic:"",idType:"CNIC",gender:"Male",boardingPoint:route.boarding,fare:route.fare,discount:0,paymentMethod:"Cash",paymentReference:""});
  const [passenger,setPassenger] = useState<PassengerForm>(blank);
  const update = <K extends keyof PassengerForm>(key:K,value:PassengerForm[K])=>setPassenger(p=>({...p,[key]:value}));
  const total = Math.max(0,route.fare*selected.length-passenger.discount);
  const choices = trips.filter(t=>t.active && t.routeId===routeId && tripBus(t,fleet).service===service && t.days.includes(serviceDayFor(date)));
  const choose = (id:string,newDate=date)=>{
    setTripId(id);setDate(newDate);setDepartureDirty(false);setSelected([]);setFocusedId(null);setAction(null);setError("");
    const next = trips.find(t=>t.id===id)!;
    setPassenger(p=>({...p,boardingPoint:tripRoute(next,routes).boarding,discount:0}));
    const url = new URL(location.href);url.searchParams.set("trip",id);url.searchParams.set("date",newDate);history.replaceState(null,"",url);
  };
  const reset = ()=>{setPassenger(blank());setSelected([]);setError("");};
  const submit = async (event:FormEvent)=>{
    event.preventDefault();if(busy)return;
    if(departureDirty)return setError("Save the vehicle number and departure time first.");
    if(!selected.length)return setError("Select an available seat.");
    if(selected.some(s=>occupied.has(s)))return setError("A selected seat was just booked. Choose another seat.");
    if(mode==="Ticket" && passenger.paymentMethod!=="Cash" && !passenger.paymentReference.trim())return setError("Enter the verified payment reference.");
    setBusy(true);setError("");
    try {
      await onSave({id:"",ticketNo:"",source:"Counter",passenger:passenger.passenger.trim(),phone:passenger.phone.trim(),cnic:passenger.cnic.trim(),gender:passenger.gender,
        route:routeLabel(route),destination:route.to,boardingPoint:passenger.boardingPoint,bus:bus.registration,service:bus.service,seats:selected,
        fare:route.fare,discount:passenger.discount,total,paid:mode==="Ticket"?total:0,balance:mode==="Ticket"?0:total,paymentMethod:passenger.paymentMethod,paymentReference:passenger.paymentReference,
        paymentStatus:mode==="Ticket"?"Paid":"Unpaid",bookingStatus:mode==="Ticket"?"Confirmed":"Reserved",date,time:trip.departure,driver:trip.driver,attendant:trip.attendant,createdAt:new Date().toISOString(),tripId:trip.id,tripRunId:runId});
      reset();
    } catch(e){setError(e instanceof Error?e.message:"Could not save. Your entries have been kept.");} finally{setBusy(false);}
  };
  const net = records.reduce((sum,b)=>sum+netCollected(b),0);
  return <div className="admin-view sale-view counter-workspace">
    <section className="surface counter-selector">
      <div className="counter-heading"><div><h1>Seat booking</h1><p>Select a departure. Everything for this journey stays here.</p></div><a className="secondary-button" href={`?trip=${encodeURIComponent(tripId)}&date=${date}`} target="_blank" rel="noreferrer">Open in another tab ↗</a></div>
      <div className="counter-filters">
        <label><span>Route</span><select value={routeId} onChange={e=>{const next=trips.find(t=>t.active&&t.routeId===e.target.value);setRouteId(e.target.value);if(next){setService(tripBus(next,fleet).service);choose(next.id);}}}>{routes.filter(r=>trips.some(t=>t.active&&t.routeId===r.id)).map(r=><option value={r.id} key={r.id}>{routeLabel(r)}</option>)}</select></label>
        <label><span>Travel date</span><input type="date" value={date} onChange={e=>{if(e.target.value)choose(tripId,e.target.value);}}/></label>
        <label><span>Bus type</span><select value={service} onChange={e=>{setService(e.target.value);const next=trips.find(t=>t.active&&t.routeId===routeId&&tripBus(t,fleet).service===e.target.value);if(next)choose(next.id);}}>{[...new Set(trips.filter(t=>t.active&&t.routeId===routeId).map(t=>tripBus(t,fleet).service))].map(value=><option key={value}>{value}</option>)}</select></label>
      </div>
      <div className="departure-times" aria-label="Departure times">{choices.map(t=>{const dated=tripOnDate(t,date,runs);return <button key={t.id} type="button" className={t.id===tripId?"active":""} onClick={()=>choose(t.id)}><strong>{dated.departure}</strong><small>{dated.status}</small></button>;})}{!choices.length&&<p>No departures for this route, type and date.</p>}</div>
      <CounterDeparture key={`${runId}-${bus.registration}-${trip.departure}`} trip={trip} bus={bus} disabled={busy||date<today||!trip.active||!trip.days.includes(serviceDayFor(date))||["Departed","Returned","Cancelled"].includes(trip.status)} onDirty={setDepartureDirty} onSave={async changes=>{const saved=await onCounterSave(trip.id,date,changes);setDepartureDirty(false);return saved;}}/>
    </section>
    <div className="seat-statistics" aria-label="Seat totals"><span className="booked"><small>Booked</small><strong>{occupied.size-reserved.size}</strong></span><span className="reserved"><small>Reserved</small><strong>{reserved.size}</strong></span><span><small>Available / {bus.seats} total</small><strong>{bus.seats-occupied.size}</strong></span></div>
    <div className="counter-main">
      <section className="surface counter-passenger">
        {focused ? <div className="seat-inspector">
          <div className="panel-heading"><h2>Seat {seatList(focused.seats,focused.service)}</h2><button type="button" className="secondary-button" onClick={()=>{setFocusedId(null);setAction(null);}}>New passenger</button></div>
          <span className="status-pill">{focused.bookingStatus}</span><h3>{focused.passenger}</h3><p>{focused.phone} · {focused.cnic}</p><p>{focused.ticketNo}</p>
          <div className="inspector-amount"><small>{focused.bookingStatus==="Reserved"?"To collect":"Net collected"}</small><strong>{money(focused.bookingStatus==="Reserved"?focused.balance:netCollected(focused))}</strong></div>
          <div className="counter-actions">
            {focused.bookingStatus==="Reserved"&&<><button type="button" className="primary-button" disabled={unavailable} onClick={()=>setAction("payment")}>Collect payment & issue ticket</button><button type="button" className="danger-button" disabled={busy} onClick={async()=>{setBusy(true);try{await onCancel(focused.id);setFocusedId(null);}catch(e){showToast(e instanceof Error?e.message:"Could not remove reservation.");}finally{setBusy(false);}}}>Remove reservation</button><small>Reserved seats have no ticket or boarding token.</small></>}
            {focused.bookingStatus!=="Reserved"&&<button type="button" className="primary-button" onClick={()=>onPrint(focused)}><Printer size={16}/> {focused.bookingStatus==="Confirmed"?"Print receipt & token":"Print refund record"}</button>}
            {focused.bookingStatus==="Confirmed"&&focused.paid===0&&<button type="button" className="danger-button" disabled={busy} onClick={async()=>{setBusy(true);try{await onCancel(focused.id);setFocusedId(null);}catch(e){showToast(e instanceof Error?e.message:"Could not cancel ticket.");}finally{setBusy(false);}}}>Cancel ticket & release seat</button>}
            {refundableBalance(focused)>0&&<button type="button" className="danger-button" onClick={()=>setAction("refund")}>Cancel / refund ticket</button>}
            {["Reserved","Confirmed"].includes(focused.bookingStatus)&&<button type="button" className="secondary-button" onClick={()=>setAction("edit")}>Edit passenger</button>}
          </div>
        </div> : <form onSubmit={submit}>
          <div className="mode-tabs"><button type="button" className={mode==="Ticket"?"active":""} onClick={()=>setMode("Ticket")}>Paid ticket</button><button type="button" className={mode==="Reservation"?"active":""} onClick={()=>setMode("Reservation")}>Reserve</button></div>
          <fieldset disabled={busy} className="counter-fields"><legend className="sr-only">Passenger details</legend><div className="form-grid">
            <label className="span-2"><span>Passenger name *</span><input required maxLength={160} value={passenger.passenger} onChange={e=>update("passenger",e.target.value)} autoComplete="off"/></label>
            <label><span>Mobile *</span><input required maxLength={30} value={passenger.phone} onChange={e=>update("phone",e.target.value)}/></label>
            <label><span>CNIC / Passport *</span><input required maxLength={50} value={passenger.cnic} onChange={e=>update("cnic",e.target.value)}/></label>
            <label><span>Gender</span><select value={passenger.gender} onChange={e=>update("gender",e.target.value as "Male"|"Female")}><option>Male</option><option>Female</option></select></label>
            <label><span>Boarding point</span><input value={passenger.boardingPoint} onChange={e=>update("boardingPoint",e.target.value)}/></label>
            <MoneyField label="Fare per seat" value={route.fare} readOnly/><MoneyField label="Total discount" value={passenger.discount} onChange={v=>update("discount",Math.min(v,route.fare*selected.length))}/>
            {mode==="Ticket"&&<><label><span>Payment</span><select value={passenger.paymentMethod} onChange={e=>update("paymentMethod",e.target.value as PaymentMethod)}><option>Cash</option><option>Card</option><option>Bank transfer</option>{paymentMode!=="disabled"&&<option>1Bill</option>}</select></label>{passenger.paymentMethod!=="Cash"&&<label><span>Payment reference *</span><input required value={passenger.paymentReference} onChange={e=>update("paymentReference",e.target.value)}/></label>}</>}
          </div></fieldset>
          <div className="counter-total"><span>{selected.length ? `Seat ${seatList(selected,bus.service)}`:"Select seats"}<small>{mode==="Ticket"?"One ticket + token per seat":"Hold only · no ticket issued"}</small></span><strong>{money(total)}</strong></div>
          {unavailable&&<p className="form-error">This departure is closed for booking.</p>}{error&&<p className="form-error" role="alert">{error}</p>}
          <div className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={reset}>Clear</button><button type="submit" className="primary-button" disabled={busy||unavailable||!choices.some(t=>t.id===tripId)}>{busy?"Saving…":mode==="Ticket"?`Collect & issue ${selected.length>1?selected.length+" tickets":"ticket"}`:"Reserve seats"}</button></div>
        </form>}
      </section>
      <section className="surface counter-seats"><div className="panel-heading"><h2>{bus.service}</h2><span>{bus.registration} · {trip.departure}</span></div>
        <SeatMap seats={bus.seats} service={bus.service} selectedSeats={selected.filter(s=>!occupied.has(s))} occupied={occupied} reserved={reserved} onOccupied={seat=>{setFocusedId(active.find(b=>b.seats.includes(seat))!.id);setAction(null);}} onSelect={seat=>{if(busy)return;setFocusedId(null);setSelected(current=>current.includes(seat)?current.filter(s=>s!==seat):[...current,seat].sort((a,b)=>a-b));}} large/>
        <p className="counter-hint">Click a blue seat to collect payment, reprint or refund.</p>
      </section>
    </div>
    <VoucherEditor key={runId} trip={trip} bus={bus} net={net} records={records} onSave={changes=>onCounterSave(trip.id,date,changes)} onReport={kind=>onReport(kind,trip.id,trip.runNumber,date)}/>
    <section className="surface counter-history"><div className="panel-heading"><h2>Passenger & ticket history</h2><input aria-label="Find passenger or ticket" placeholder="Name, phone, ticket…" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="table-wrap"><table><thead><tr><th>Seat</th><th>Passenger</th><th>Status</th><th>Collected</th><th>Action</th></tr></thead><tbody>{records.filter(b=>`${b.passenger} ${b.phone} ${b.ticketNo}`.toLowerCase().includes(search.toLowerCase())).map(b=><tr key={b.id}><td>{seatList(b.seats,b.service)}</td><td><strong>{b.passenger}</strong><small>{b.ticketNo}</small></td><td><span className="status-pill">{b.bookingStatus}</span></td><td>{money(netCollected(b))}</td><td><button type="button" className="text-button" onClick={()=>{setFocusedId(b.id);document.querySelector(".counter-main")?.scrollIntoView({behavior:"smooth",block:"start"});}}>Manage</button></td></tr>)}</tbody></table></div></section>
    {focused&&action==="payment"&&<CollectPaymentModal booking={focused} paymentMode={paymentMode} onClose={()=>setAction(null)} onConfirm={async(method,reference)=>{await onConfirm(focused.id,method,reference);setAction(null);}}/>}
    {focused&&action==="refund"&&<RefundModal booking={focused} onClose={()=>setAction(null)} onRefund={onRefund}/>}
    {focused&&action==="edit"&&<BookingEditModal booking={focused} onClose={()=>setAction(null)} onSave={async b=>{await onUpdate(b);setAction(null);}}/>}
  </div>;
}

function CounterDeparture({trip,bus,disabled,onDirty,onSave}:{trip:TripRecord;bus:BusRecord;disabled:boolean;onDirty:(dirty:boolean)=>void;onSave:(changes:CounterChanges)=>Promise<TripRun>}) {
  const [registration,setRegistration]=useState(bus.registration),[departure,setDeparture]=useState(trip.departure),[busy,setBusy]=useState(false),[error,setError]=useState("");
  return <form className="counter-manual" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError("");try{await onSave({registration,departure,expected:{registration:bus.registration,departure:trip.departure,revision:trip.snapshot?.voucher?.revision??""}});}catch(e){setError(e instanceof Error?e.message:"Could not save departure.");}finally{setBusy(false);}}}>
    <label><span>Vehicle number</span><input aria-label="Vehicle number" value={registration} maxLength={30} disabled={disabled||busy} onChange={e=>{setRegistration(e.target.value);onDirty(e.target.value!==bus.registration||departure!==trip.departure);}} required/></label><label><span>Actual departure</span><input aria-label="Actual departure" type="time" value={departure} disabled={disabled||busy} onChange={e=>{setDeparture(e.target.value);onDirty(registration!==bus.registration||e.target.value!==trip.departure);}} required/></label><button className="secondary-button" disabled={disabled||busy||(registration===bus.registration&&departure===trip.departure)}>Save bus / time</button>{error&&<p className="form-error">{error}</p>}
  </form>;
}

function VoucherEditor({trip,bus,net,records,onSave,onReport}:{trip:TripRecord;bus:BusRecord;net:number;records:Booking[];onSave:(changes:CounterChanges)=>Promise<TripRun>;onReport:(kind:ReportKind)=>void}) {
  const saved=trip.snapshot?.voucher;
  const [draft,setDraft]=useState<Voucher>(()=>saved??{commissionRate:0,manualCommission:0,refreshments:0,terminalExpense:0,toll:0,misc:0,paidToDriver:0,driver:trip.driver,attendant:trip.attendant});
  const [revision,setRevision]=useState(saved?.revision??"");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const fields=[['commissionRate','Commission %'],['manualCommission','Additional commission'],['refreshments','Refreshments'],['terminalExpense','Terminal expense'],['toll','Toll / parchi'],['misc','Miscellaneous'],['paidToDriver','Paid to driver']] as const;
  const commission=Math.round(net*draft.commissionRate)/100+draft.manualCommission;
  const deductions=commission+draft.refreshments+draft.terminalExpense+draft.toll+draft.misc;
  const dirty=!saved||fields.some(([key])=>saved[key]!==draft[key])||saved.driver!==draft.driver||saved.attendant!==draft.attendant||Math.abs((saved.basis??0)-net)>.005;
  const stale=revision!==(saved?.revision??"");
  const cash=records.reduce((sum,b)=>sum+(b.paymentMethod==="Cash"?b.paid:0)-(b.refunds??[]).filter(r=>r.method==="Cash").reduce((a,r)=>a+r.amount,0),0);
  return <section className="surface counter-voucher"><div className="panel-heading"><div><h2>Voucher summary</h2><p>{saved?`Saved by ${saved.savedBy} · ${formatPrintTime(saved.savedAt)}`:"Enter deductions and crew, then save to print."}</p></div><button type="button" className="secondary-button" onClick={()=>onReport("cnic")}><FileText size={16}/> Passenger / CNIC sheet</button></div>
    <form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError("");try{const updated=await onSave({registration:bus.registration,departure:trip.departure,voucher:draft,expected:{registration:bus.registration,departure:trip.departure,revision}});setRevision(updated.snapshot!.voucher!.revision!);setDraft(updated.snapshot!.voucher!);}catch(e){setError(e instanceof Error?e.message:"Voucher could not be saved.");}finally{setBusy(false);}}}>
      <fieldset disabled={busy} className="counter-fields"><div className="voucher-fields">{fields.map(([key,label])=><label key={key}><span>{label}</span><input type="number" min="0" max={key==="commissionRate"?100:10000000} step="0.01" value={draft[key]} onChange={e=>setDraft({...draft,[key]:Number(e.target.value)})}/></label>)}<label><span>Driver</span><input value={draft.driver} maxLength={120} onChange={e=>setDraft({...draft,driver:e.target.value})}/></label><label><span>Hostess</span><input value={draft.attendant} maxLength={120} onChange={e=>setDraft({...draft,attendant:e.target.value})}/></label></div></fieldset>
      <div className="voucher-calculation"><span>Net collection <strong>{money(net)}</strong></span><span>Commission <strong>{money(commission)}</strong></span><span>Total deductions <strong>{money(deductions)}</strong></span><span>Cash remaining <strong>{money(cash-deductions-draft.paidToDriver)}</strong></span></div>
      <p className="counter-hint">Commission is calculated on net collection after refunds. Driver payment is a cash handover, separate from operating expenses.</p>
      {stale&&<p className="form-error">A newer voucher is saved. <button type="button" onClick={()=>{setDraft(saved!);setRevision(saved!.revision!);setError("");}}>Load saved voucher</button></p>}{error&&<p className="form-error">{error}</p>}
      <div className="form-actions"><button className="primary-button" disabled={busy||stale}>{busy?"Saving…":"Save voucher"}</button><button type="button" className="secondary-button" disabled={dirty||stale||busy} onClick={()=>onReport("terminal-a4")}><Printer size={16}/> Voucher / PDF</button><button type="button" className="secondary-button" disabled={dirty||stale||busy} onClick={()=>onReport("terminal-thermal")}>80mm voucher</button></div>
    </form>
  </section>;
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
              {seatList(booking.seats, booking.service)}
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
              {seatList(booking.seats, booking.service)}
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
                  seatList(booking.seats, booking.service, " "),
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
                      <span className="seat-list">{seatList(b.seats, b.service)}</span>
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
                          onClick={() => { if (window.confirm(`Cancel reservation ${b.ticketNo} and release seats ${seatList(b.seats, b.service)}?`)) onCancel(b.id); }}
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
            <p>{booking.ticketNo} · {booking.passenger} · Seats {seatList(booking.seats, booking.service)}</p>
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
                      <span className="seat-list">{seatLabel(seat, booking.service)}</span>
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
  const [printedAt, setPrintedAt] = useState(() => new Date());
  const [printing, setPrinting] = useState(false);
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
  const methodTotal = (method: PaymentMethod) => records.reduce((sum, booking) => sum + (booking.paymentMethod === method ? booking.paid : 0) - (booking.refunds ?? []).filter((refund) => refund.method === method).reduce((amount, refund) => amount + refund.amount, 0), 0);
  const ledgerRecords = records.filter(booking=>booking.paid>0);
  const printedBookings = voucher ? ledgerRecords : report.kind === "cnic" ? runBookings : [...runBookings, ...records.filter((booking) => booking.bookingStatus === "Reserved")];
  const rows = printedBookings.flatMap((booking) =>
    booking.seats.map((seat) => ({ booking, seat })),
  );
  const total = gross - refunds;
  const savedVoucher = trip.snapshot?.voucher;
  const voucherStale = voucher && (!savedVoucher || Math.abs((savedVoucher.basis ?? 0) - total) > .005);
  const totals: (string | number)[][] = [["Tickets issued", ledgerRecords.length], ["Payments received",money(gross)]];
  if (refunds) totals.push(["Refunds",money(refunds)]);
  totals.push(["Net collected",money(total)]);
  if (savedVoucher) {
    totals.push([`Commission (${savedVoucher.commissionRate}%)`,money(savedVoucher.commission ?? 0)]);
    for (const [label,value] of [["Terminal expense",savedVoucher.terminalExpense],["Refreshments",savedVoucher.refreshments],["Toll / parchi",savedVoucher.toll],["Miscellaneous",savedVoucher.misc]] as const) if(value) totals.push([label,money(value)]);
    totals.push(["Total deductions",money(savedVoucher.deductions??0)]);
    if(savedVoucher.paidToDriver) totals.push(["Paid to driver",money(savedVoucher.paidToDriver)]);
    totals.push(["Balance cash",money(methodTotal("Cash")-(savedVoucher.deductions??0)-savedVoucher.paidToDriver)]);
  }

  const title = {
    manifest: "Bus Detail",
    cnic: "Passenger CNIC Sheet",
    "terminal-a4": "Terminal Voucher Report",
    "terminal-thermal": "Terminal Voucher",
  }[report.kind];
  const thermal = report.kind === "terminal-thermal";
  const printReport = async () => {
    const printClass = thermal ? "printing-thermal" : "printing-a4";
    const cleanup = () => document.body.classList.remove(printClass);
    setPrinting(true);
    try {
      await document.fonts.load('12px "Noto Nastaliq Urdu"');
      await document.fonts.ready;
      flushSync(() => setPrintedAt(new Date()));
      document.body.classList.add(printClass);
      window.addEventListener("afterprint", cleanup, { once: true });
      window.print();
    } finally {
      cleanup();
      setPrinting(false);
    }
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
              disabled={printing || voucherStale}
              onClick={() => void printReport()}
            >
              <Printer size={16} /> {printing ? "Preparing…" : "Print"}
            </button>
          </div>
        </div>
        {voucherStale && <p className="form-error">Save the current voucher summary on the ticketing page before printing. Collections may have changed.</p>}
        <article
          className={`print-document operations-document document-${report.kind} ${thermal ? "report-thermal" : "report-a4 report-landscape"}`}
        >
          <header className="document-header">
            <div>
              <h1>MADINA EXPRESS</h1>
              <p className="document-brand-urdu" lang="ur" dir="rtl">مدینہ ایکسپریس</p>
              <p>Madina Terminal, Peshawar</p>
              <p>0311-777-2299 / 0315-777-2299</p>
            </div>
            <div className="document-title-block">
              <h2>{title}</h2>
              <p>{ticketDate(report.date)} · Run {report.runNumber}</p>
              <strong>{bus.registration}</strong>
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
                {ticketDate(report.date)} · {trip.departure}
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
              <small>Attendant</small>
              <strong>{trip.attendant}</strong>
            </span>
          </div>
          {thermal ? (
            <>
              <h3 className="document-section-title">Passenger &amp; ticket register</h3>
              {rows.map(({ booking, seat }) => (
                <div
                  className="thermal-passenger"
                  key={`${booking.id}-${seat}`}
                >
                  <span>
                    <b>Seat {seatLabel(seat, booking.service)}</b>
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
              <h3 className="document-section-title">Collection summary</h3>
              <div className="thermal-total">{totals.map(([label, value]) => <span className={label === "Net collected" ? "document-grand-total" : undefined} key={label}>{label}<b>{value}</b></span>)}</div>
            </>
          ) : report.kind === "terminal-a4" ? (
            <>
              <h3 className="document-section-title">Ticket &amp; payment register</h3>
              <table className="document-table">
                <colgroup>{[14, 16, 20, 10, 6, 10, 24].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Issued by / time</th>
                    <th>Passenger</th>
                    <th>Destination</th>
                    <th>Seats</th>
                    <th>Channel</th>
                    <th>Net collected</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerRecords.map((booking) => (
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
                      <td>{seatList(booking.seats, booking.service)}</td>
                      <td>{booking.paymentMethod}</td>
                      <td>{money(netCollected(booking))}{refundedTotal(booking)>0&&<small>Refund {money(refundedTotal(booking))}</small>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!ledgerRecords.length && <p className="document-empty">No tickets recorded for this departure.</p>}
              <h3 className="document-section-title">Collection summary</h3>
              <div className="voucher-summary-grid">{totals.map(([label,value]) => <span className={label === "Net collected" ? "document-grand-total" : undefined} key={label}><small>{label}</small><strong>{value}</strong></span>)}</div>
            </>
          ) : (
            <table className="document-table">
              <colgroup>{(report.kind === "cnic" ? [4, 15, 8, 10, 8, 6, 12, 21, 16] : [12, 19, 6, 11, 15, 8, 19, 10]).map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
              <thead>
                <tr>
                  {report.kind === "cnic" ? (
                    <>
                      <th>Seat #</th>
                      <th>Terminal</th>
                      <th>Destination</th>
                      <th>Issued by</th>
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
                      <td>{seatLabel(seat, booking.service)}</td>
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
                      <td>{seatLabel(seat, booking.service)}<small>{booking.ticketNo}</small></td>
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
          {voucher && <div className="document-signatures"><span>Prepared by</span><span>Checked by</span></div>}
          <footer className="document-footer">
            <span>Printed {ticketDate(dateInPakistan(printedAt))} · {ticketTime(printedAt)}</span>
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
  const [expenses,setExpenses] = useState<ExpenseRecord[]>([]);
  const [expenseError,setExpenseError] = useState("");
  const [expensesLoaded,setExpensesLoaded] = useState(false);
  useEffect(()=>{let active=true;const refresh=()=>api.listExpenses<ExpenseRecord>().then(result=>{if(active){setExpenses(result.expenses);setExpensesLoaded(true);setExpenseError("");}}).catch(e=>{if(active)setExpenseError(e instanceof Error?e.message:"Could not load expenses.");});void refresh();const timer=window.setInterval(()=>void refresh(),30000);return()=>{active=false;window.clearInterval(timer);};},[]);
  const expenseTotal=expenses.reduce((sum,e)=>sum+e.amount,0);
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
                  ...expenses.map(e=>["Expense","",e.description,e.paymentMethod,e.reference,-e.amount,e.category,e.date,"",e.createdBy]),
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
      {expenseError && <p className="form-error">{expenseError}</p>}
      <section className="surface finance-cost-summary"><div><small>Operating expenses (includes saved vouchers)</small><strong>{expensesLoaded?money(expenseTotal):"Loading…"}</strong></div><div><small>Net after refunds & expenses</small><strong>{expensesLoaded?money(total-expenseTotal):"Loading…"}</strong></div></section>
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
                  <span className="seat-list">{seatList(b.seats, b.service)}</span>
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
                        title={b.bookingStatus==="Reserved"?"Reservation has no ticket":"Print ticket"}
                        disabled={b.bookingStatus==="Reserved"}
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
  service,
  selectedSeats,
  occupied,
  reserved = new Set<number>(),
  onOccupied,
  onSelect,
  large = false,
}: {
  seats: number;
  service: string;
  selectedSeats: number[];
  occupied: Set<number>;
  reserved?: Set<number>;
  onOccupied?: (seat:number)=>void;
  onSelect: (seat: number) => void;
  large?: boolean;
}) {
  const sleeper = isSleeper(service);
  const renderSeat = (seat: number | null) => seat === null
    ? <span className="seat-space" aria-hidden="true" />
    : <SeatButton seat={seat} label={seatLabel(seat, service)}
        selected={selectedSeats.includes(seat)} occupied={occupied.has(seat)}
        reserved={reserved.has(seat)} interactive={Boolean(onOccupied)} onSelect={occupied.has(seat) && onOccupied ? onOccupied : onSelect} />;
  return (
    <div className={`seat-map-wrap reference-seat-map ${sleeper ? "sleeper-map" : "coach-map"} ${large ? "large" : ""}`}>
      <div className="legend">
        <span><i className="available" />Available</span>
        <span><i className="selected" />Selected</span>
        <span><i className="reserved" />Reserved</span><span><i className="booked" />Booked</span>
      </div>
      <div className="bus-shell">
        <div className="bus-front">
          <span><BusFront size={17} /> FRONT</span>
          <span>DRIVER</span>
        </div>
        {sleeper ? <>
          <div className="sleeper-deck-headings"><span>A ROOMS</span><span>B ROOMS</span></div>
          <div className="sleeper-layout" aria-label="Sleeper rooms">
            {sleeperRows(seats).map((rooms, index) => (
              <div className="sleeper-room-row" key={index}>
                {rooms.map((room, roomIndex) => room.seats.length ? (
                  <div className="sleeper-room" role="group" aria-label={`Room ${room.label}`} key={roomIndex}>
                    <span className="room-caption">ROOM</span>
                    <strong className="room-label">{room.label}</strong>
                    <div className="room-berths">{room.seats.map((seat) => <span key={seat}>{renderSeat(seat)}</span>)}</div>
                  </div>
                ) : <span key={roomIndex} aria-hidden="true" />)}
              </div>
            ))}
          </div>
          {seats > 30 && <div className="sleeper-rear" aria-label="Rear sleeper seats">
            {Array.from({length: Math.ceil((seats - 30) / 3)}, (_, row) => (
              <div className="sleeper-rear-row" key={row}>
                {Array.from({length: Math.min(3, seats - 30 - row * 3)}, (_, index) => 31 + row * 3 + index).map((seat) => (
                  <div className="sleeper-room" key={seat}><span className="room-caption">ROOM</span>{renderSeat(seat)}</div>
                ))}
              </div>
            ))}
          </div>}
          <p className="sleeper-selection-note">Select each berth separately in a shared room.</p>
        </> : <div className="seat-layout" aria-label="Coach seating plan">
          {coachRows(seats).map((row, index) => (
            <div className={`seat-row ${row.center ? "rear-bench" : ""}`} key={index}>
              <div className="seat-pair">{row.left.map((seat, position) => <span key={position}>{renderSeat(seat)}</span>)}</div>
              <div className="aisle">{row.center ? renderSeat(row.center) : null}</div>
              <div className="seat-pair">{row.right.map((seat, position) => <span key={position}>{renderSeat(seat)}</span>)}</div>
            </div>
          ))}
        </div>}
      </div>
    </div>
  );
}
function SeatButton({
  seat,
  label,
  selected,
  occupied,
  reserved,
  interactive,
  onSelect,
}: {
  seat: number;
  label: string;
  selected: boolean;
  occupied: boolean;
  reserved: boolean;
  interactive: boolean;
  onSelect: (seat: number) => void;
}) {
  const status = reserved ? "reserved" : occupied ? "booked" : selected ? "selected" : "available";
  return (
    <button
      type="button"
      disabled={occupied && !interactive}
      className={`seat seat--${status}`}
      aria-label={`Seat ${label}, ${status}`}
      aria-pressed={selected && !occupied}
      onClick={() => onSelect(seat)}
    >
      <b>{label}</b>
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

function ReceiptModal({booking,batch=[],onClose}:{booking:Booking;batch?:Booking[];onClose:()=>void}) {
  const [printing,setPrinting]=useState(false);
  const [printedAt,setPrintedAt]=useState(()=>new Date());
  const entries=batch.length?batch:[booking];
  if(booking.bookingStatus==="Reserved")return <div className="receipt-overlay" role="dialog" aria-modal="true" aria-label="Reservation saved"><div className="receipt-modal reservation-confirmation"><h2>Seats reserved</h2><p>{booking.passenger} · Seat {seatList(booking.seats,booking.service)}</p><p>{booking.route} · {ticketDate(booking.date)} · {booking.time}</p><p>Pay at the terminal to receive your ticket and boarding token.</p><button className="primary-button" onClick={onClose}>Done</button></div></div>;
  const print = async()=>{setPrinting(true);try{await document.fonts.load('12px "Noto Nastaliq Urdu"');await document.fonts.ready;flushSync(()=>setPrintedAt(new Date()));window.print();}finally{setPrinting(false);}};
  return <div className="receipt-overlay" role="dialog" aria-modal="true" aria-label={`Ticket ${booking.ticketNo}`}><div className="receipt-modal ticket-print-modal">
    <div className="receipt-toolbar"><div><strong>{entries.length>1?`${entries.length} separate tickets`:"Passenger ticket"}</strong><small>Receipt and boarding token print on separate slips · 80mm</small></div><button type="button" aria-label="Close ticket" onClick={onClose}><X size={18}/></button></div>
    <div className="receipt thermal-ticket">{entries.filter(b=>b.bookingStatus!=="Reserved").flatMap(b=>b.seats.map((seat,index)=>{
      // Legacy multi-seat records remain intact; reprints apportion totals in cents.
      const share=(amount:number)=>{const cents=Math.round(amount*100);return (Math.floor(cents/b.seats.length)+(index<cents%b.seats.length?1:0))/100;};
      return <TicketSlips key={`${b.id}-${seat}`} booking={{...b,seats:[seat],total:share(b.total),paid:share(b.paid),discount:share(b.discount),refunds:(b.refunds??[]).map(r=>({...r,amount:share(r.amount)}))}} printedAt={printedAt}/>;
    }))}</div>
    <div className="receipt-actions"><button className="secondary-button" onClick={onClose}>Close</button><button className="primary-button" disabled={printing} onClick={()=>void print()}><Printer size={16}/>{printing?"Preparing…":ticketPresentation(booking).canBoard?"Print receipt & token":"Print refund record"}</button></div>
  </div></div>;
}
function TicketSlips({booking,printedAt}:{booking:Booking;printedAt:Date}) {
  const ticket=ticketPresentation(booking),seats=seatList(booking.seats,booking.service);
  return <>
    <article className="passenger-receipt" aria-label={`Passenger receipt seat ${seats}`}>
      <header className="thermal-heading"><h2>MADINA EXPRESS</h2><p className="ticket-contact">0311-777-2299 / 0315-777-2299</p></header>
      <div className="ticket-bus-type"><span>BUS Type</span><strong>{booking.service}</strong></div>
      <div className="ticket-departure"><dl><div className="ticket-seat-number"><dt>SEAT NO #</dt><dd>{seats}</dd></div><div><dt>Departure</dt><dd>{booking.time}</dd></div><div><dt>Travel date</dt><dd>{ticketDate(booking.date)}</dd></div></dl><QRCodeSVG value={`MADINA EXPRESS\nTicket: ${booking.ticketNo}\nSeat: ${seats}`} size={76} level="M" marginSize={2} title="Ticket reference"/></div>
      <table className="thermal-details"><tbody>
        <tr><th>Passenger</th><td>{booking.passenger}</td></tr><tr><th>Route</th><td>{booking.route}</td></tr><tr><th>Destination</th><td>{booking.destination}</td></tr><tr><th>Terminal</th><td>{booking.boardingPoint}</td></tr>
        <tr className="ticket-fare"><th>{ticket.canBoard?"Fare paid":"Net paid"}</th><td>{money(netCollected(booking))}</td></tr>
        {refundedTotal(booking)>0&&<tr><th>Refunded</th><td>{money(refundedTotal(booking))}</td></tr>}
        <tr><th>Ticket No.</th><td className="ticket-identifier">{booking.ticketNo}</td></tr><tr><th>Bus No.</th><td>{booking.bus}</td></tr><tr><th>Printed</th><td>{ticketTime(printedAt)} · {ticketDate(dateInPakistan(printedAt))}</td></tr>
      </tbody></table>
      {!ticket.canBoard&&<div className="thermal-payment-status"><strong>{ticket.status}</strong></div>}
      <div className="ticket-terms ticket-urdu" lang="ur" dir="rtl"><p>روانگی سے دس منٹ پہلے پہنچیں۔ ٹکٹ کی تاریخ، وقت اور سیٹ نمبر چیک کریں۔ اصل شناختی کارڈ ہمراہ رکھیں۔</p></div>
    </article>
    {ticket.canBoard&&<><div className="ticket-cut-line"><span>SEPARATE BOARDING TOKEN</span></div><article className="conductor-token" aria-label={`Conductor boarding token seat ${seats}`}>
      <header><strong>MADINA EXPRESS</strong><span>BOARDING TOKEN</span></header><div className="token-seats"><span>SEAT NO #</span><strong>{seats}</strong></div>
      <table className="token-table"><tbody><tr><th>Bus No.</th><th>Destination</th></tr><tr><td>{booking.bus}</td><td>{booking.destination}</td></tr><tr><th>Travel date</th><th>Departure</th></tr><tr><td>{ticketDate(booking.date)}</td><td className="token-time">{booking.time}</td></tr><tr><th>Ticket No.</th><th>Paid</th></tr><tr><td>{booking.ticketNo}</td><td>{money(netCollected(booking))}</td></tr></tbody></table>
      <p className="ticket-urdu" lang="ur" dir="rtl">یہ ٹوکن کنڈکٹر کے حوالے کریں۔</p>
    </article></>}
  </>;
}

export default App;
