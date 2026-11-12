import { StaffPolicyContext, useStaffPolicy, type OperatingPolicies } from "./operating-policies";
import { runningBuild, type ReleaseInfo } from "./release";
import { AccountAccessSettings, BookingPolicySettings, ApplicationUpdateSettings } from "./system-settings";
import {routeDestinations,seatFare,seatClass,departureTimes,commissionPolicy,type SeatClass,type RouteService} from "../shared/service-pricing.mjs";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { downloadReservationPdf } from "./reservation-pdf";
import { presentationText, shortPaymentReference, shortRouteCode } from "./presentation-text";
import { inDateRange, type DateRange } from "./booking-filters";
import { ticketPresentation, ticketDate, ticketTime } from "./ticket-format";
import { printDocument, printTicketBatch, type TicketPaper } from "./print-document";
import { connectEpsonTicketPrinter } from "./epson-ticket-printer";
import {
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
  | "passengers"
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

type DepartureAction = "pause" | "resume" | "depart" | "reopen" | "close-sales";
type DepartureOptions = {confirm?:boolean;resolveReservations?:boolean};
type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
type ReportKind = "manifest" | "cnic" | "terminal-a4" | "terminal-thermal";

type RouteRecord = {
  destinations?: {name:string;fare:number}[];
  services?: RouteService[];
  deleted?: boolean;
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
  layoutId?:string;
  seatClasses?:SeatClass[];
  commissionRate?:number;
  isTemplate?: boolean;
  deleted?: boolean;
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
  deleted?: boolean;
  salesPaused?: boolean;
  salesOverride?: boolean;
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
type CounterChanges = {registration: string; departure: string; layoutBusId?: string; voucher?: Voucher; expected: {registration: string; departure: string; revision: string; busId?: string}};
type TripRun = {
  salesPaused?: boolean;
  salesOverride?: boolean;
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
  quotedFares?:number[];
  fareOverrides?: (number | null)[];
  id: string;
  ticketNo: string;
  source: BookingSource;
  passenger: string;
  phone: string;
  cnic: string;
  gender: "Male" | "Female" | "Unspecified";
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
  username: string;
  isOwner?: boolean; remoteAllowed?: boolean; email?: string; terminals?: number[]; mfaRequired?: boolean; mfaConfigured?: boolean;
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
type PublicReservation = Pick<Booking, "ticketNo" | "passenger" | "route" | "destination" |
  "boardingPoint" | "service" | "seats" | "total" | "date" | "time"> & { expiresAt: string | null };
type PublicJourney = Pick<PublicReservation, "route" | "destination" | "boardingPoint" | "service" |
  "seats" | "date" | "time"> & {
    reference: string;
    status: BookingStatus | "Expired";
    expiresAt: string | null;
  };
type PublicBootstrap = {
  terminalAvailable?: boolean;
  trips: TripRecord[];
  fleet: BusRecord[];
  routes: RouteRecord[];
  occupancy: PublicOccupancy[];
};
type AdminBootstrap = {
  policies?:OperatingPolicies;
  release?: ReleaseInfo;
  readOnly?: boolean;
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
  destination:string;
  passenger: string;
  phone: string;
  cnic: string;
  idType: "CNIC" | "Passport";
  gender: "Male" | "Female" | "Unspecified";
  boardingPoint: string;
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
  return run ? { ...trip, ...run.snapshot, status: run.status, salesPaused:run.salesPaused, salesOverride:run.salesOverride, runNumber: run.runNumber, busId: run.busId, driver: run.driver, attendant: run.attendant, platform: run.platform, snapshot: run.snapshot, departedAt: run.departedAt, returnedAt: run.returnedAt, notes: run.notes } : { ...trip, status: "Scheduled", runNumber: 1 };
};
const tripBus = (trip: TripRecord, fleet: BusRecord[]) => {
  const saved=trip.snapshot?.bus;
  if(!saved)return fleet.find(bus=>bus.id===trip.busId)!;
  const managed=fleet.find(bus=>bus.id===(saved.layoutId||saved.id));
  return {...saved,...(managed?{model:managed.model,seatClasses:managed.seatClasses,commissionRate:managed.commissionRate}:{})};
};
const vehicleLabel = (bus?:BusRecord)=>bus?.isTemplate?"Not assigned":presentationText(bus?.registration??"Not assigned");
const tripRoute = (trip: TripRecord, routes: RouteRecord[]) => {
  const current=routes.find(route=>route.id===trip.routeId);
  return trip.snapshot?.route ? {...trip.snapshot.route,...(current?{destinations:current.destinations,services:current.services}: {})} : current!;
};
const serviceDayFor = (date: string) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${date}T12:00:00`).getDay()] as Weekday;
const tripsOnDate = (trips: TripRecord[], date: string, runs: TripRun[]) =>
  trips.filter((trip) => !trip.deleted && (trip.days.includes(serviceDayFor(date)) || runs.some((run) => run.tripId === trip.id && run.date === date)))
    .map((trip) => tripOnDate(trip, date, runs))
    .sort((left, right) => left.departure.localeCompare(right.departure));
const refundedTotal = (booking: Booking) =>
  (booking.refunds ?? []).reduce((sum, refund) => sum + refund.amount, 0);
const refundableBalance = (booking: Booking) =>
  Math.max(0, booking.paid - refundedTotal(booking));
const netCollected = (booking: Booking) =>
  Math.max(0, booking.paid - refundedTotal(booking));
function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) =>
      row.map((value) => {
        const text = presentationText(String(value));
        const safe = typeof value === "string" && /^(?:[\t\r\n]|\s*[=+@-])/.test(text) ? "'" + text : text;
        return `"${safe.replaceAll('"', '""')}"`;
      }).join(","),
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
    [loadError, setLoadError] = useState(""),
    [terminalAvailable, setTerminalAvailable] = useState(true);
  useEffect(() => {
    api
      .publicBootstrap<PublicBootstrap>()
      .then((result) => {
        setTerminalAvailable(result.terminalAvailable !== false);
        setPublicTrips(result.trips);
        setPublicFleet(result.fleet);
        setPublicRoutes(result.routes);
        setOccupancy(result.occupancy);
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
      .then((result) => { if (active) { setTerminalAvailable(result.terminalAvailable !== false); setTripRuns(result.runs); setOccupancy(result.occupancy as PublicOccupancy[]); setPublicFleet(result.fleet as BusRecord[]); setPublicTrips(result.trips as TripRecord[]); setPublicRoutes(result.routes as RouteRecord[]); setLoadError(""); } })
      .catch(() => { if (active) setLoadError("Availability could not be refreshed. Please try again."); });
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [date]);
  const [checkoutTrip, setCheckoutTrip] = useState<{
    destination?:string;
    route: RouteRecord;
    bus: BusRecord;
    schedule: TripRecord;
    time: string;
    fare: number;
    occupiedSeats: number[];
  } | null>(null);
  const [reservation, setReservation] = useState<PublicReservation[]>([]);
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
        .flatMap((route) => routeDestinations(route).map(d=>d.name)),
    ),
  );
  const matchingRoutes = publicRoutes.filter(
    (route) => route.from === from && routeDestinations(route).some(d=>d.name===to),
  );
  const travelDay = serviceDayFor(date);
  const departures = matchingRoutes.length
    ? tripsOnDate(publicTrips, date, tripRuns)
        .filter(
          (schedule) =>
            matchingRoutes.some(route=>route.id===schedule.routeId) &&
            schedule.active && !schedule.salesPaused &&
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
          const route=matchingRoutes.find(route=>route.id===schedule.routeId)!;
          return {
            route,
            schedule,
            time: schedule.departure,
            bus,
            fare: Math.min(...Array.from({length:bus.seats},(_,i)=>seatFare(route,bus,to,i+1))),
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
          <a href="#routes">Reserve a seat</a>
          <a href="#ticket-lookup">Check a ticket</a>
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
              Reserve your seat.
              <br />
              <em>Travel with confidence.</em>
            </h1>
            <p>
              Find a departure, reserve your seats online and pay at the terminal.
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
              <p>Choose your seats and reserve online.</p>
            </div>
            <div className="payment-assurance">
              <ShieldCheck size={15} /> Pay at the counter
            </div>
          </div>
          {loadError && <p className="form-error">{loadError}</p>}
          {!terminalAvailable && <p className="form-error" role="status">The terminal is temporarily offline. Timetables remain available; please contact the counter to reserve.</p>}
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
          <a className="lookup-jump" href="#ticket-lookup">Already booked? Check your ticket or reservation</a>
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
            {matchingRoutes.length && departures.length ? (
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
                    <strong>{trip.route.duration||to}</strong>
                    <small>{trip.route.to}</small>
                  </div>
                  <div className="public-trip-service">
                    <strong>{trip.bus.model||trip.bus.service}</strong>
                    <small>
                      {trip.bus.isTemplate?"Vehicle assigned at terminal":trip.bus.registration} · {trip.seats} seats available
                    </small>
                  </div>
                  <div className="public-trip-price">
                    <small>Fare from</small>
                    <strong>{money(trip.fare)}</strong>
                  </div>
                  <button
                    type="button"
                    disabled={trip.seats === 0 || !terminalAvailable}
                    onClick={() => {
                      if (!terminalAvailable) { setLoadError("The terminal is temporarily offline. Please contact the counter."); return; }
                      setCheckoutTrip({
                        route: trip.route,
                        destination:to,
                        bus: trip.bus,
                        schedule: trip.schedule,
                        time: trip.time,
                        fare: trip.fare,
                        occupiedSeats: trip.occupiedSeats,
                      });
                    }}
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
        <PublicTicketLookup />
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
                See live seat availability and choose your seats in one
                reservation.
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
                Download your reservation confirmation and show it when you pay at the counter.
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
          onClose={() => setCheckoutTrip(null)}
          onReserved={(bookings) => {
            setCheckoutTrip(null);
            setReservation(bookings);
          }}
        />
      )}
      {reservation.length > 0 && (
        <ReservationConfirmation bookings={reservation} onClose={() => setReservation([])} />
      )}
    </div>
  );
}

const journeyStatuses: Record<PublicJourney["status"], string> = {
  Confirmed: "Confirmed ticket",
  Reserved: "Reserved · Pay at the counter",
  Expired: "Reservation expired",
  Cancelled: "Cancelled",
  Refunded: "Refunded",
};

function PublicTicketLookup() {
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");
  const [journey, setJourney] = useState<PublicJourney | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setJourney(null);
    try {
      const result = await api.lookupJourney<PublicJourney>(reference.trim(), phone.trim());
      setJourney(result.journey);
    } catch (error) {
      setError(error instanceof ApiError ? error.message : "Ticket lookup is unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="route-finder public-lookup" id="ticket-lookup" aria-labelledby="ticket-lookup-heading">
      <div className="route-finder-heading">
        <span><Ticket size={18} /></span>
        <div>
          <h2 id="ticket-lookup-heading">Check a ticket or reservation</h2>
          <p>Use the reference and mobile number from your booking.</p>
        </div>
      </div>
      <form className="public-search lookup-form" onSubmit={search}>
        <label>
          <span>Ticket or reservation reference</span>
          <input value={reference} onChange={event => setReference(event.target.value)} maxLength={40}
            placeholder="e.g. ME-000123 or RS-000123" autoCapitalize="characters" spellCheck={false} required />
        </label>
        <label>
          <span>Booking mobile number</span>
          <input type="tel" value={phone} onChange={event => setPhone(event.target.value)} maxLength={30}
            placeholder="03XX XXXXXXX" required />
        </label>
        <button className="search-journey" type="submit" disabled={busy}>
          <Search size={16} /> {busy ? "Checking…" : "Check details"}
        </button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div aria-live="polite">
        {journey && (
          <article className="lookup-result">
            <div className="lookup-result-heading">
              <h3>{journey.reference}</h3>
              <strong>{journeyStatuses[journey.status]}</strong>
            </div>
            <dl>
              <div><dt>Route</dt><dd>{journey.route}</dd></div>
              <div><dt>Destination</dt><dd>{journey.destination}</dd></div>
              <div><dt>Departure</dt><dd>{ticketDate(journey.date)} · {journey.time} PKT</dd></div>
              <div><dt>Boarding point</dt><dd>{journey.boardingPoint}</dd></div>
              <div><dt>Seats</dt><dd>{seatList(journey.seats, journey.service)}</dd></div>
              <div><dt>Bus type</dt><dd>{journey.service}</dd></div>
              {journey.expiresAt && <div><dt>Held until</dt><dd>{reservationHoldLabel(journey.expiresAt)} PKT</dd></div>}
            </dl>
          </article>
        )}
      </div>
    </section>
  );
}

function PublicCheckout({
  trip,
  date,
  onClose,
  onReserved,
}: {
  trip: {
    destination?:string;
    route: RouteRecord;
    bus: BusRecord;
    schedule: TripRecord;
    time: string;
    fare: number;
    occupiedSeats: number[];
  };
  date: string;
  onClose: () => void;
  onReserved: (bookings: PublicReservation[]) => void;
}) {
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]),
    [passenger, setPassenger] = useState({
      name: "",
      phone: "",
    }),
    [processing, setProcessing] = useState(false),
    [error, setError] = useState("");
  const [reservationPolicy,setReservationPolicy]=useState({maxSeats:4,expiryEnabled:true,expiryHours:2});
  useEffect(()=>{api.publicBootstrap<{reservationPolicy?:{maxSeats:number;expiryEnabled:boolean;expiryHours:number}}>().then(result=>{if(result.reservationPolicy)setReservationPolicy(result.reservationPolicy);}).catch(()=>undefined);},[]);
  const [destination,setDestination]=useState(trip.destination||routeDestinations(trip.route).at(-1)!.name);
  const total = selectedSeats.reduce((sum,seat)=>sum+seatFare(trip.route,trip.bus,destination,seat),0);
  const occupied = useMemo(
    () => new Set(trip.occupiedSeats),
    [trip.occupiedSeats],
  );
  const toggleSeat = (seat: number) => {
    if (occupied.has(seat)) return;
    setSelectedSeats((current) =>
      current.includes(seat)
        ? current.filter((item) => item !== seat)
        : current.length < reservationPolicy.maxSeats
          ? [...current, seat].sort((a, b) => a - b)
          : current,
    );
  };
  const reserveSeats = async () => {
    if (
      !selectedSeats.length ||
      !passenger.name.trim() ||
      !passenger.phone.trim()
    ) {
      setError(
        "Select a seat and enter the passenger name and mobile number.",
      );
      return;
    }
    setError("");
    setProcessing(true);
    try {
      const result = await api.createPublicBooking<PublicReservation>({
        passenger: passenger.name.trim(),
        phone: passenger.phone.trim(),
        destination,
        tripId: trip.schedule.id,
        date,
        seats: selectedSeats,
        quotedFares:selectedSeats.map(seat=>seatFare(trip.route,trip.bus,destination,seat)),
      });
      onReserved(result.bookings);
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
      aria-label="Reserve seats"
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
              seatClasses={trip.bus.seatClasses}
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
                text="Use the name and mobile number you will give at the counter."
              />
              <div className="checkout-form">
                {routeDestinations(trip.route).length>1&&<label><span>Destination</span><select value={destination} onChange={e=>setDestination(e.target.value)}>{routeDestinations(trip.route).map(stop=><option key={stop.name}>{stop.name}</option>)}</select></label>}
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
              </div>
            </section>
            <section className="checkout-card payment-card">
              <SectionTitle
                number="3"
                title="Reservation summary"
                text="The counter issues tickets after payment."
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
                  <small>Total fare</small>
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
                    <RefreshCw className="spin" size={17} /> Reserving seats…
                  </>
                ) : (
                  <>
                    <CalendarCheck size={17} /> Confirm reservation
                  </>
                )}
              </button>
              <small className="gateway-note">
                <ShieldCheck size={13} /> {reservationPolicy.expiryEnabled?`Unpaid reservations expire after ${reservationPolicy.expiryHours} hour(s) or at departure, whichever comes first.`:"No automatic reservation expiry is currently applied. Contact the counter to collect your ticket."}
              </small>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function reservationHoldLabel(expiresAt: string) {
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi",
  }).format(new Date(expiresAt));
}

function ReservationConfirmation({ bookings, onClose }: { bookings: PublicReservation[]; onClose: () => void }) {
  const card = useRef<HTMLElement>(null);
  const autoDownloadStarted = useRef(false);
  const downloadInProgress = useRef(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const first = bookings[0];
  const reference = first.ticketNo;
  const until = first.expiresAt ? reservationHoldLabel(first.expiresAt) : "No automatic expiry";

  const download = useCallback(async () => {
    if (!card.current || downloadInProgress.current) return;
    downloadInProgress.current = true;
    setDownloading(true);
    setError("");
    try {
      await downloadReservationPdf(card.current, reference);
    } catch {
      setError("The PDF could not be downloaded. Please try the download button.");
    } finally {
      downloadInProgress.current = false;
      setDownloading(false);
    }
  }, [reference]);

  useEffect(() => {
    if (autoDownloadStarted.current) return;
    autoDownloadStarted.current = true;
    void download();
  }, [download]);

  return (
    <div className="receipt-overlay" role="dialog" aria-modal="true" aria-label="Reservation confirmation">
      <div className="receipt-modal reservation-confirmation">
        <article className="reservation-card" ref={card}>
          <p className="reservation-brand">MADINA EXPRESS</p>
          <h2>Reservation confirmation</h2>
          <p className="reservation-banner">UNPAID · NOT VALID FOR BOARDING</p>
          <dl>
            <dt>Passenger</dt><dd>{first.passenger}</dd>
            <dt>Route</dt><dd>{first.route}</dd>
            <dt>Destination</dt><dd>{first.destination}</dd>
            <dt>Departure</dt><dd>{ticketDate(first.date)} · {first.time} PKT</dd>
            <dt>Terminal</dt><dd>{first.boardingPoint}</dd>
            <dt>Seats / references</dt><dd>{bookings.map(booking => <span key={booking.ticketNo}>{seatList(booking.seats, booking.service)} · {booking.ticketNo}</span>)}</dd>
            <dt>Amount due</dt><dd>{money(bookings.reduce((total, booking) => total + booking.total, 0))}</dd>
            <dt>Held until</dt><dd>{until} PKT</dd>
          </dl>
          <p>Show this confirmation at the counter and pay before the hold expires to receive your travel tickets.</p>
        </article>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="receipt-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Done</button>
          <button className="primary-button" type="button" onClick={download} disabled={downloading}>
            <FileText size={16} /> {downloading ? "Preparing PDF…" : "Download reservation PDF"}
          </button>
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
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [otp, setOtp] = useState(""),
    [requiresOtp, setRequiresOtp] = useState(false),
    [loginNotice, setLoginNotice] = useState(""),
    [signingIn, setSigningIn] = useState(false);
  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username || !password) return;
    setSigningIn(true);
    setLoginNotice("");
    try {
      await api.login<{ user: StaffUser }>(username, password, otp);
      onNavigate("/manage");
    } catch (error) {
      if (error instanceof ApiError && error.code === "authenticator_required") setRequiresOtp(true);
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
            <span>Username or email</span>
            <input
              value={username}
              onChange={(event) => { setUsername(event.target.value); setRequiresOtp(false); setOtp(""); }}
              placeholder="Enter your username or optional email"
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
          {requiresOtp && <label>
            <span>Authenticator code</span>
            <input value={otp} onChange={event => setOtp(event.target.value)} inputMode="numeric"
              autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
          </label>}
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
      { id: "passengers" as AdminView, label: "Passengers", icon: UsersRound },
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
  admin: ["dashboard", "sale", "passengers", "bookings", "reservations", "trips", "fleet", "routes", "finance", "expenses", "reports", "crew", "settings"],
  manager: ["dashboard", "sale", "passengers", "bookings", "reservations", "trips", "fleet", "routes", "reports", "crew", "settings"],
  counter: ["dashboard", "sale", "passengers", "bookings", "reservations", "reports", "settings"],
  dispatcher: ["trips", "sale", "fleet", "reports", "crew", "settings"],
  finance: ["passengers", "bookings", "reports", "settings"],
};
const defaultAdminView = (user: StaffUser): AdminView => {
  if (user.forcePasswordChange) return "settings";
  if (["admin", "manager", "counter"].includes(user.role)) return "dashboard";
  return roleViews[user.role][0];
};
const autoPrintPreference = "madina.autoPrintTickets";
const ticketPaperPreference = "madina.ticketPaper";
function autoPrintEnabled() {
  try {
    return localStorage.getItem(autoPrintPreference) === "true";
  } catch {
    return false;
  }
}
function getTicketPaper(): TicketPaper {
  try {
    const paper = localStorage.getItem(ticketPaperPreference);
    return paper === "a4" || paper === "tm-t88iv" ? paper : "thermal";
  } catch {
    return "thermal";
  }
}

type AutomaticPrintRequest = { bookingId: string; entries: Booking[]; paper: TicketPaper };

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
    [newCounterSchedule, setNewCounterSchedule] = useState<{ date: string; defaults?: Partial<TripRecord> } | null>(null),
    [routes, setRoutes] = useState<RouteRecord[]>([]),
    [crew, setCrew] = useState<CrewRecord[]>([]),
    [staffUsers, setStaffUsers] = useState<StaffUser[]>([]),
    [receipt, setReceipt] = useState<Booking | null>(null),
    [receiptBatch, setReceiptBatch] = useState<Booking[]>([]),
    [automaticPrints, setAutomaticPrints] = useState<AutomaticPrintRequest[]>([]),
    [report, setReport] = useState<{
      kind: ReportKind;
      tripId: string;
      runNumber: number;
      date: string;
    } | null>(null),
    [toast, setToast] = useState(""),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [paymentMode, setPaymentMode] = useState("disabled"),
    [cloudReadOnly, setCloudReadOnly] = useState(false),
    [availableBuild,setAvailableBuild]=useState<ReleaseInfo>(),
    [staffPolicy,setStaffPolicy]=useState<OperatingPolicies|null>(null);
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
        setCloudReadOnly(Boolean(result.readOnly));setAvailableBuild(result.release);setStaffPolicy(result.policies||null);
        onUserChange(result.user);
      })
      .catch((error: unknown) =>
        setLoadError(error instanceof Error ? error.message : "Operations data could not be loaded."),
      )
      .finally(() => setLoading(false));
  }, [onUserChange]);
  const [lastUpdated,setLastUpdated]=useState("");
  const [refreshError,setRefreshError]=useState("");
  const [refreshing,setRefreshing]=useState(false);
  const refreshingRef=useRef(false);
  const dataVersion=useRef(0);
  const refreshData=useCallback(async()=>{
    if(refreshingRef.current)return;
    refreshingRef.current=true;setRefreshing(true);
    const version=dataVersion.current;
    try{
      const result=await api.adminBootstrap<AdminBootstrap>();
      setCloudReadOnly(Boolean(result.readOnly));setAvailableBuild(result.release);setStaffPolicy(result.policies||null);
      if(version!==dataVersion.current)return;
      setBookings(result.bookings);setTrips(result.trips);setRuns(result.runs);setFleet(result.fleet);setRoutes(result.routes);setCrew(result.crew);setStaffUsers(result.users);
      setLastUpdated(new Date().toLocaleTimeString("en-GB",{timeZone:"Asia/Karachi"}));setRefreshError("");
    }catch(e){setRefreshError(e instanceof Error?e.message:"Live updates unavailable. Refresh to retry.");}
    finally{refreshingRef.current=false;setRefreshing(false);}
  },[]);
  useEffect(()=>{
    const refresh=()=>{if(!document.hidden)void refreshData();};
    const timer=window.setInterval(refresh,5000);
    window.addEventListener("focus",refresh);
    return()=>{window.clearInterval(timer);window.removeEventListener("focus",refresh);};
  },[refreshData]);
  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);
  const failure = (error: unknown) =>
    showToast(error instanceof Error ? error.message : "The request failed.");
  const saveCounter = async (tripId: string, date: string, draft: CounterChanges) => {
    const result = await api.saveCounterDeparture<TripRun>(tripId, {date, ...draft});
      dataVersion.current++;
    setRuns(current => [...current.filter(run => run.id !== result.trip.id), result.trip]);
    const updatedBus = result.trip.snapshot!.bus;
    setFleet(current => [...current.filter(bus => bus.id !== updatedBus.id), updatedBus]);
    setBookings(current => current.map(booking => booking.tripRunId === result.trip.id && ["Confirmed","Reserved"].includes(booking.bookingStatus) ? {...booking, bus: updatedBus.isTemplate?"To be assigned":updatedBus.registration, service: updatedBus.service, time: result.trip.snapshot!.departure, driver: result.trip.driver, attendant: result.trip.attendant} : booking));
    showToast(draft.voucher ? "Voucher saved. Expenses updated." : "Bus and departure time saved.");
    return result.trip;
  };
  const openIssuedReceipt = (booking: Booking, batch: Booking[] = []) => {
    if (autoPrintEnabled() && booking.bookingStatus === "Confirmed") {
      const request = { bookingId: booking.id, entries: batch.length ? batch : [booking], paper: getTicketPaper() };
      setAutomaticPrints(current => [...current, request]);
      return;
    }
    setReceiptBatch(batch);
    setReceipt(booking);
  };
  const finishAutomaticPrint = useCallback((bookingId: string, error?: string) => {
    setAutomaticPrints(current => current.filter(request => request.bookingId !== bookingId));
    if (error) showToast(error);
  }, [showToast]);
  const saveBooking = async (booking: Booking) => {
    try {
      const result = await api.createBooking<Booking>(booking);
      dataVersion.current++;
      setBookings((current) => [...result.bookings, ...current]);
      if (result.booking.bookingStatus === "Confirmed") openIssuedReceipt(result.booking, result.bookings);
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
      dataVersion.current++;
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
      dataVersion.current++;
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
      dataVersion.current++;
      setBookings((current) => current.map((item) => item.id === id ? result.booking : item));
      showToast(`${money(refund.amount)} refund recorded with an audit trail.`);
    } catch (error) {
      failure(error);
      throw error;
    }
  };
  const confirmReservation = async (id: string, method: PaymentMethod, reference: string, details?:Partial<Booking>) => {
    try {
      const result = await api.confirmReservation<Booking>(id, method, reference, details);
      dataVersion.current++;
      setBookings((current) => current.map((item) => item.id === id ? result.booking : item));
      openIssuedReceipt(result.booking);
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
      dataVersion.current++;
      setFleet((current) => isNew ? [result.bus, ...current] : current.map((item) => item.id === bus.id ? result.bus : item));
      showToast("Bus layout saved.");
    } catch (error) {
      failure(error);throw error;
    }
  };
  const deleteBus = async (id: string) => {
    try {
      const bus = fleet.find((item) => item.id === id);
      await api.deleteBus(id);
      dataVersion.current++;
      setFleet(current=>current.map(item=>item.id===id?{...item,deleted:true}:item));
      setTrips(current=>current.map(item=>item.busId===id?{...item,deleted:true,active:false}:item));
      showToast(`${bus?.model ?? "Bus layout"} deleted.`);
    } catch (error) {
      failure(error);
      throw error;
    }
  };
  const saveTrip = async (trip: TripRecord) => {
    try {
      const isNew = !trips.some((item) => item.id === trip.id);
      const result = await api.saveTrip<TripRecord>(trip.id, trip, isNew);
      dataVersion.current++;
      setTrips((current) => isNew ? [result.trip, ...current] : current.map((item) => item.id === trip.id ? result.trip : item));
      showToast("Recurring trip saved.");
      return result.trip;
    } catch (error) {
      failure(error);
      throw error;
    }
  };
  const deleteTrip = async (id: string) => {
    try {
      await api.deleteTrip(id);
      dataVersion.current++;
      setTrips(current=>current.map(item=>item.id===id?{...item,deleted:true,active:false}:item));
      showToast("Schedule deleted. Ticket history retained.");
    } catch (error) {
      failure(error);
      throw error;
    }
  };
  const saveRoute = async (route: RouteRecord) => {
    try {
      const isNew = !routes.some((item) => item.id === route.id);
      const result = await api.saveRoute<RouteRecord>(route.id, route, isNew);
      dataVersion.current++;
      setRoutes((current) => isNew ? [result.route, ...current] : current.map((item) => item.id === route.id ? result.route : item));
      showToast(`${routeLabel(result.route)} saved.`);
    } catch (error) {
      failure(error);
      throw error;
    }
  };
  const deleteRoute = async (id: string) => {
    try {
      const route = routes.find((item) => item.id === id);
      await api.deleteRoute(id);
      dataVersion.current++;
      setRoutes(current=>current.map(item=>item.id===id?{...item,deleted:true,status:"Paused"}:item));
      setTrips(current=>current.map(item=>item.routeId===id?{...item,deleted:true,active:false}:item));
      showToast(`${route ? routeLabel(route) : "Route"} deleted.`);
    } catch (error) {
      failure(error);
      throw error;
    }
  };
  const saveCrewMember = async (person: CrewRecord, previousName?: string) => {
    try {
      const result = await api.saveCrew<CrewRecord>(previousName, person);
      dataVersion.current++;
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
  const transitionTrip = async (id: string, action: DepartureAction, date: string, notes = "", options:DepartureOptions={}) => {
    try {
      const result = await api.transitionTrip<TripRun>(id, action, date, notes,options);
      dataVersion.current++;
      setRuns((current) => [...current.filter((run) => run.id !== result.trip.id), result.trip]);
      const fresh = await api.adminBootstrap<AdminBootstrap>();
      setTrips(fresh.trips); setFleet(fresh.fleet); setRuns(fresh.runs);setBookings(fresh.bookings);
      showToast(action === "depart" ? "Bus departed. Tickets closed." : action==="pause"?"Seat sales paused.":action==="resume"?"Seat sales resumed.":action==="reopen"?"Counter sales reopened. Override recorded.":"Counter sales closed.");
    } catch (error) { failure(error); throw error; }
  };
  const startSale = (tripId: string, date: string) => {
    setSaleTarget({ tripId, date }); changeView("sale");
  };
  const canManageSchedules = ["admin", "manager", "dispatcher"].includes(user.role);
  const activeRoutes = routes.filter(route => !route.deleted && route.status === "Active");
  const canAddSchedule = canManageSchedules && activeRoutes.length > 0 && fleet.some(bus => !bus.deleted && bus.isTemplate && bus.status !== "Retired");
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
    <StaffPolicyContext.Provider value={user.role==="admin"?null:staffPolicy}><div
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
            Peshawar<br/><span title={runningBuild.releaseId}>v{runningBuild.version} · {runningBuild.commit?.slice(0,7)||"development"}</span>
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
        <TerminalConnectionBanner />
        {availableBuild && availableBuild.releaseId!==runningBuild.releaseId && <div className="terminal-connection-notice" role="status">Version {availableBuild.version} is ready. Finish your current entry, then <button className="text-action" onClick={()=>window.location.reload()}>Refresh</button>.</div>}
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
          {activeView === "sale" && (!trips.some(t=>!t.deleted) || !routes.some(r=>!r.deleted) || !fleet.some(b=>!b.deleted) ? (
            <section className="surface counter-selector">
              <EmptyState title="Add a departure first" text="Choose a route, bus layout and recurring departure time to open seat booking." />
              {canAddSchedule && <button type="button" className="secondary-button" onClick={() => setNewCounterSchedule({ date: today })}><Plus size={16}/> Add departure</button>}
            </section>
          ) : (
            <BookingWorkspace
              key={saleTarget ? `${saleTarget.tripId}-${saleTarget.date}-${saleTarget.mode}` : "sale"}
              initialSelection={saleTarget}
              readOnly={cloudReadOnly || user.role==="dispatcher"}
              onTransition={transitionTrip}
              onRefresh={refreshData} refreshing={refreshing} lastUpdated={lastUpdated} refreshError={refreshError}
              onCounterSave={saveCounter}
              onAddDeparture={canAddSchedule ? (date, defaults) => setNewCounterSchedule({ date, defaults }) : undefined}
              onDeleteDeparture={canManageSchedules ? deleteTrip : undefined}
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
          {activeView === "passengers" && <PassengersView bookings={bookings} onManage={["admin","manager","counter"].includes(user.role)?startSale:undefined}/>}
          {activeView === "bookings" && (
            <BookingsView
              bookings={bookings}
              onPrint={booking => {setReceiptBatch([]);setReceipt(booking);}}
              onUpdate={updateBooking}
              onRefund={processRefund}
              canEdit={["admin", "manager", "counter"].includes(user.role)}
              canRefund={["admin", "manager", "counter", "finance"].includes(user.role)}
            />
          )}
          {activeView === "reservations" && (
            <ReservationsView
              trips={trips} runs={runs} routes={routes} fleet={fleet}
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
              onSave={async trip => { await saveTrip(trip); }}
              onDelete={deleteTrip}
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
            <RoutesView fleet={fleet} routes={routes} onSave={saveRoute} onDelete={deleteRoute} />
          )}
          {activeView === "finance" && (
            <FinanceProtected onOpenSettings={() => changeView("settings")}>
              <FinanceView bookings={bookings} />
            </FinanceProtected>
          )}
          {activeView === "expenses" && (
            <FinanceProtected onOpenSettings={() => changeView("settings")}>
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
              onStaffSaved={(staff) => {
                dataVersion.current++;
                setStaffUsers(current => [...current.filter(account => account.id !== staff.id), staff]);
              }}
              onStaffRemoved={(id) => {
                dataVersion.current++;
                setStaffUsers(current => current.filter(account => account.id !== id));
              }}
              showToast={showToast}
            />
          )}
        </main>
      </div>
      {newCounterSchedule && (
        <TripFormModal
          fleet={fleet}
          routes={activeRoutes}
          defaults={{ ...newCounterSchedule.defaults, departure: "" }}
          onClose={() => setNewCounterSchedule(null)}
          onSave={async draft => {
            const saved = await saveTrip(draft);
            setNewCounterSchedule(null);
            startSale(saved.id, newCounterSchedule.date < today ? today : newCounterSchedule.date);
          }}
        />
      )}
      {receipt && (
        <ReceiptModal
          key={receipt.id}
          booking={receipt}
          batch={receiptBatch}
          paper={getTicketPaper()}
          onClose={() => {
            setReceipt(null);
            setReceiptBatch([]);
          }}
        />
      )}
      {automaticPrints.map(request => (
        <AutomaticTicketPrint key={request.bookingId} request={request} onFinish={finishAutomaticPrint} />
      ))}
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
    </div></StaffPolicyContext.Provider>
  );
}

function DateRangeFilter({value,onChange,defaultValue={from:"",to:""},label="Travel dates"}:{value:DateRange;onChange:(range:DateRange)=>void;defaultValue?:DateRange;label?:string}) {
  const invalid = Boolean(value.from && value.to && value.from > value.to);
  return <div className="date-range-filter" role="group" aria-label={`${label} range`}>
    <span>{label}</span>
    <label><span>From</span><input aria-label="From date" type="date" value={value.from} max={value.to||undefined} onChange={e=>onChange({...value,from:e.target.value})}/></label>
    <label><span>To</span><input aria-label="To date" type="date" value={value.to} min={value.from||undefined} onChange={e=>onChange({...value,to:e.target.value})}/></label>
    <button type="button" className="text-button" onClick={()=>onChange(defaultValue)}>Reset dates</button>
    {invalid&&<span role="alert" className="form-error">From date must be on or before To date.</span>}
  </div>;
}

function DashboardView({bookings,trips,fleet,routes,onNavigate,userName}:{bookings:Booking[];trips:TripRecord[];fleet:BusRecord[];routes:RouteRecord[];onNavigate:(view:AdminView)=>void;userName:string}) {
  const [range,setRange]=useState<DateRange>({from:today,to:today});
  const records=bookings.filter(b=>inDateRange(b.date,range));
  const confirmed=records.filter(b=>b.bookingStatus==="Confirmed");
  const reservations=records.filter(b=>b.bookingStatus==="Reserved");
  const count=(items:Booking[])=>items.reduce((sum,b)=>sum+b.seats.length,0);
  const metrics=[
    {label:"Booked seats",value:count(confirmed),note:"Confirmed tickets",icon:Ticket,tone:"green"},
    {label:"Reserved seats",value:count(reservations),note:"Waiting for payment",icon:CalendarCheck,tone:"blue"},
    {label:"Online seats",value:count([...confirmed,...reservations].filter(b=>b.source==="Public web")),note:"Booked + reserved",icon:UsersRound,tone:"gold"},
    {label:"Cancelled / refunded",value:count(records.filter(b=>["Cancelled","Refunded"].includes(b.bookingStatus))),note:"Released tickets and holds",icon:ReceiptText,tone:"orange"},
  ];
  return <div className="admin-view dashboard-view">
    <ViewHeading eyebrow="OPERATIONS" title={`Welcome, ${userName.split(" ")[0]}`} text="Ticket activity for your selected travel dates." action={<button className="primary-button" onClick={()=>onNavigate("sale")}><Plus size={16}/> Seat booking</button>}/>
    <DateRangeFilter value={range} onChange={setRange} defaultValue={{from:today,to:today}}/>
    <section className="metric-grid">{metrics.map(m=><article className="metric-card" key={m.label}><span className={`metric-icon ${m.tone}`}><m.icon size={19}/></span><div><small>{m.label}</small><strong>{m.value.toLocaleString("en-PK")}</strong><p>{m.note}</p></div></article>)}</section>
    <section className="surface recent-panel"><SurfaceHeader title="Passenger activity" text={`${records.length} ticket / reservation records in this date range`} action={<button onClick={()=>onNavigate("passengers")}>Passenger directory <ChevronRight size={15}/></button>}/>{records.length?<BookingTable bookings={records.slice(0,8)} onPrint={()=>undefined} compact/>:<EmptyState title="No tickets in this date range" text="Select different travel dates to see passenger activity."/>}</section>
    <section className="surface schedule-panel"><SurfaceHeader title={`Today's departures · ${today}`} text="Current boarding status" action={<button onClick={()=>onNavigate("trips")}>Roster <ChevronRight size={15}/></button>}/>
      <div className="schedule-list">{trips.filter(t=>t.active&&t.days.includes(serviceDayFor(today))&&!["Returned","Cancelled"].includes(t.status)).map(t=>{
        const bus=tripBus(t,fleet),route=tripRoute(t,routes);if(!bus||!route)return null;
        const sold=bookings.filter(b=>b.tripRunId===tripRunKey(t,t.runNumber,today)&&b.bookingStatus==="Confirmed").flatMap(b=>b.seats).length;
        return <article key={t.id}><time>{t.departure}</time><span className={`timeline-dot ${t.status.toLowerCase()}`}/><div className="schedule-route"><strong>{routeLabel(route)}</strong><small>{vehicleLabel(bus)} · {bus.service}</small></div><div className="schedule-load"><small>{sold}/{bus.seats} booked</small></div><b className={`plain-status ${t.status.toLowerCase()}`}>{t.status}</b></article>;
      })}</div>
    </section>
  </div>;
}

function PassengersView({bookings,onManage}:{bookings:Booking[];onManage?: (id:string,date:string)=>void}) {
  const [range,setRange]=useState<DateRange>({from:"",to:""});
  const [search,setSearch]=useState(""),[status,setStatus]=useState("All");
  const visible=bookings.filter(b=>inDateRange(b.date,range)&&(status==="All"||b.bookingStatus===status)&&`${b.passenger} ${b.phone} ${b.cnic} ${b.ticketNo} ${b.route} ${b.bus}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="admin-view"><ViewHeading eyebrow="PASSENGER DIRECTORY" title="Passengers" text="Contact details and journey history, including reservations, cancelled tickets and refunds." action={<button className="secondary-button" onClick={()=>downloadCsv("madina-passengers.csv",[["Passenger","Mobile","CNIC / Passport","Gender","Ticket","Travel date","Time","Route","Boarding","Bus","Type","Seats","Source","Status","Paid","Refunded","Balance"],...visible.map(b=>[b.passenger,b.phone,b.cnic,b.gender,b.ticketNo,b.date,b.time,b.route,b.boardingPoint,b.bus,b.service,seatList(b.seats,b.service),b.source,b.bookingStatus,b.paid,refundedTotal(b),["Reserved","Confirmed"].includes(b.bookingStatus)?b.balance:0])])}><FileBarChart size={16}/> Export filtered records</button>}/>
    <section className="surface data-surface"><DateRangeFilter value={range} onChange={setRange}/><DataToolbar tabs={["All","Confirmed","Reserved","Cancelled","Refunded"]} active={status} onTab={setStatus} search={search} onSearch={setSearch} placeholder="Name, phone, CNIC, ticket or route"/>
      <p className="directory-count">{visible.length} records · One row per ticket or reservation</p><div className="table-wrap"><table><thead><tr><th>Passenger</th><th>Contact / ID</th><th>Journey</th><th>Ticket / seat</th><th>Payment</th>{onManage&&<th>Action</th>}</tr></thead><tbody>{visible.map(b=><tr key={b.id}>
        <td><strong>{b.passenger}</strong><small>{b.gender}</small></td><td><strong>{b.phone}</strong><small>{b.cnic}</small></td>
        <td><strong>{b.route}</strong><small>{b.date} · {b.time} · {b.bus}</small><small>{b.service} · {b.boardingPoint}</small></td>
        <td><strong>{b.ticketNo}</strong><small>Seat {seatList(b.seats,b.service)} · {b.source}</small><span className="status-pill">{b.bookingStatus}</span></td>
        <td><strong>{money(netCollected(b))} net</strong><small>{b.paymentMethod} · {b.paymentStatus}</small><small>Refunded {money(refundedTotal(b))} · Due {money(["Reserved","Confirmed"].includes(b.bookingStatus)?b.balance:0)}</small></td>
        {onManage&&<td>{b.tripId&&<button className="text-button" onClick={()=>onManage(b.tripId!,b.date)}>Open departure</button>}</td>}
      </tr>)}</tbody></table>{!visible.length&&<EmptyState title="No matching passengers" text="Change the dates or search to find a passenger."/>}</div>
    </section></div>;
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

function BookingWorkspace({bookings,trips,fleet,routes,runs,initialSelection,onSave,showToast,paymentMode,onCounterSave,onAddDeparture,onDeleteDeparture,onPrint,onCancel,onConfirm,onRefund,onUpdate,onReport,onTransition,onRefresh,refreshing,lastUpdated,refreshError,readOnly}: {
  bookings: Booking[]; trips: TripRecord[]; fleet: BusRecord[]; routes: RouteRecord[]; runs: TripRun[];
  onTransition:(id:string,action:DepartureAction,date:string,notes?:string,options?:DepartureOptions)=>Promise<void>;
  readOnly:boolean;
  onRefresh:()=>Promise<void>;refreshing:boolean;lastUpdated:string;refreshError:string;
  initialSelection: {tripId:string;date:string;mode?:"Ticket"|"Reservation"}|null;
  onSave: (booking:Booking)=>Promise<void>; showToast:(message:string)=>void; paymentMode:string;
  onCounterSave:(id:string,date:string,changes:CounterChanges)=>Promise<TripRun>;
  onAddDeparture?: (date: string, defaults: Partial<TripRecord>) => void;
  onDeleteDeparture?: (id: string) => Promise<void>;
  onPrint:(booking:Booking)=>void; onCancel:(id:string)=>Promise<void>;
  onConfirm:(id:string,method:PaymentMethod,reference:string,details?:Partial<Booking>)=>Promise<void>;
  onRefund:(id:string,refund:RefundTransaction)=>Promise<void>; onUpdate:(booking:Booking)=>Promise<void>;
  onReport:(kind:ReportKind,id:string,run:number,date?:string)=>void;
}) {
  const params = new URLSearchParams(location.search);
  const initialDate = initialSelection?.date ?? params.get("date") ?? today;
  const requestedTrip = trips.find(t=>t.id===(initialSelection?.tripId ?? params.get("trip")));
  const defaultTrip = requestedTrip && (!requestedTrip.deleted || initialDate < today) ? requestedTrip :
    trips.find(t=>t.active&&!t.deleted&&t.routeId===requestedTrip?.routeId) ?? trips.find(t=>t.active&&!t.deleted) ?? trips[0];
  const [tripId,setTripId] = useState(defaultTrip.id);
  const [date,setDate] = useState(initialDate);
  const [routeId,setRouteId] = useState(defaultTrip.routeId);
  const [mode,setMode] = useState<"Ticket"|"Reservation">(initialSelection?.mode ?? "Ticket");
  const [selected,setSelected] = useState<number[]>([]);
  const [busy,setBusy] = useState(false), [error,setError] = useState("");
  const [focusedId,setFocusedId] = useState<string|null>(null);
  const [action,setAction] = useState<"payment"|"refund"|"edit"|null>(null);
  const [search,setSearch] = useState("");
  const [departureDirty,setDepartureDirty] = useState(false);
  const [departureToRemove, setDepartureToRemove] = useState<TripRecord | null>(null);
  const passengerForm = useRef<HTMLFormElement>(null);
  const trip = tripOnDate(trips.find(t=>t.id===tripId) ?? defaultTrip,date,runs);
  const bus = tripBus(trip,fleet), route = tripRoute(trip,routes);
  const [selectionBasis,setSelectionBasis]=useState("");
  const selectionContext=`${trip.id}/${date}/${bus.id}/${bus.service}/${bus.seats}/${trip.departure}`;
  const chosenSeats=selectionBasis===selectionContext?selected:[];
  const runId = tripRunKey(trip,trip.runNumber,date);
  const records = bookings.filter(b=>b.tripRunId===runId);
  const active = records.filter(b=>["Reserved","Confirmed"].includes(b.bookingStatus));
  const occupied = new Set(active.flatMap(b=>b.seats));
  const reserved = new Set(active.filter(b=>b.bookingStatus==="Reserved").flatMap(b=>b.seats));
  const focused = records.find(b=>b.id===focusedId);
  const unavailable = readOnly || date < today || trip.deleted || trip.salesPaused || (!trip.salesOverride && ["Departed","Returned","Cancelled"].includes(trip.status)) || !trip.active || !trip.days.includes(serviceDayFor(date)) || ["Maintenance","Retired"].includes(bus.status);
  const blank = ():PassengerForm=>({destination:routeDestinations(route).at(-1)!.name,passenger:"",phone:"",cnic:"",idType:"CNIC",gender:"Unspecified",boardingPoint:route.boarding,discount:0,paymentMethod:"Cash",paymentReference:""});
  const [passenger,setPassenger] = useState<PassengerForm>(blank);
  const update = <K extends keyof PassengerForm>(key:K,value:PassengerForm[K])=>setPassenger(p=>({...p,[key]:value}));
  const destinations=routeDestinations(route);
  const destination=destinations.some(d=>d.name===passenger.destination)?passenger.destination:destinations.at(-1)!.name;
  const [fareEdits, setFareEdits] = useState<Partial<Record<number, number>>>({});
  const baseFares = chosenSeats.map(seat => seatFare(route, bus, destination, seat));
  const fareOverrides = mode === "Ticket" ? chosenSeats.map(seat => fareEdits[seat] ?? null) : [];
  const fares = baseFares.map((fare, index) => fareOverrides[index] ?? fare);
  const fareTotal = fares.reduce((sum, fare) => sum + fare, 0);
  const discount = mode === "Ticket" ? Math.min(passenger.discount, fareTotal) : 0;
  const total = Math.round((fareTotal - discount) * 100) / 100;
  const choices = tripsOnDate(trips, date, runs).filter(t=>t.active && t.routeId===routeId && t.days.includes(serviceDayFor(date)));
  const selectedDeparture = choices.find(item => item.id === tripId);
  const paymentBlocked = busy || unavailable || departureDirty || !choices.some(item => item.id === tripId);
  const collectFromSeat = (seat: number) => {
    if (paymentBlocked || document.querySelector('[role="dialog"][aria-modal="true"]')) return false;
    if (focused?.bookingStatus === "Reserved" && focused.seats.includes(seat)) {
      setAction("payment");
      return true;
    }
    if (!focused && mode === "Ticket" && chosenSeats.includes(seat) && passengerForm.current) {
      passengerForm.current.requestSubmit();
      return true;
    }
    return false;
  };
  const choose = (id:string,newDate=date)=>{
    setTripId(id);setDate(newDate);setDepartureDirty(false);setSelected([]);setFocusedId(null);setAction(null);setError("");
    setFareEdits({});
    const next = trips.find(t=>t.id===id)!;
    setPassenger(p=>({...p,destination:routeDestinations(tripRoute(next,routes)).at(-1)!.name,boardingPoint:tripRoute(next,routes).boarding,discount:0}));
    const url = new URL(location.href);url.searchParams.set("trip",id);url.searchParams.set("date",newDate);history.replaceState(null,"",url);
  };
  const reset = ()=>{setPassenger(blank());setSelected([]);setFareEdits({});setError("");};
  const submit = async (event:FormEvent)=>{
    event.preventDefault();
    if (paymentBlocked) return;
    if(!chosenSeats.length)return setError("Select an available seat.");
    if(chosenSeats.some(s=>occupied.has(s)))return setError("A selected seat was just booked. Choose another seat.");
    if(mode==="Ticket" && passenger.gender==="Unspecified")return setError("Select the passenger gender.");
    if(mode==="Ticket" && passenger.paymentMethod!=="Cash" && !passenger.paymentReference.trim())return setError("Enter the verified payment reference.");
    setBusy(true);setError("");
    try {
      await onSave({id:"",ticketNo:"",source:"Counter",passenger:passenger.passenger.trim(),phone:passenger.phone.trim(),cnic:passenger.cnic.trim(),gender:passenger.gender,
        quotedFares:baseFares,fareOverrides:mode==="Ticket"?fareOverrides:undefined,route:routeLabel(route),destination,boardingPoint:passenger.boardingPoint,bus:bus.registration,service:bus.service,seats:chosenSeats,
        fare:fareTotal/chosenSeats.length,discount,total,paid:mode==="Ticket"?total:0,balance:mode==="Ticket"?0:total,paymentMethod:passenger.paymentMethod,paymentReference:passenger.paymentReference,
        paymentStatus:mode==="Ticket"?"Paid":"Unpaid",bookingStatus:mode==="Ticket"?"Confirmed":"Reserved",date,time:trip.departure,driver:trip.driver,attendant:trip.attendant,createdAt:new Date().toISOString(),tripId:trip.id,tripRunId:runId});
      reset();
    } catch(e){setError(e instanceof Error?e.message:"Could not save. Your entries have been kept.");} finally{setBusy(false);}
  };
  const net = records.reduce((sum,b)=>sum+netCollected(b),0);
  return <div className="admin-view sale-view counter-workspace">
    <section className="surface counter-selector">
      <div className="counter-heading"><div><h1>Seat booking</h1><p>Select a departure. Everything for this journey stays here.</p></div><a className="secondary-button" href={`?trip=${encodeURIComponent(tripId)}&date=${date}`} target="_blank" rel="noreferrer">Open in another tab ↗</a></div>
      <div className="counter-filters">
        <label><span>Route</span><select value={routeId} onChange={e=>{const next=trips.find(t=>!t.deleted&&t.active&&t.routeId===e.target.value);setRouteId(e.target.value);if(next)choose(next.id);}}>{routes.filter(r=>trips.some(t=>!t.deleted&&t.active&&t.routeId===r.id)).map(r=><option value={r.id} key={r.id}>{routeLabel(r)}</option>)}</select></label>
        <label><span>Travel date</span><input type="date" value={date} onChange={e=>{if(e.target.value)choose(tripId,e.target.value);}}/></label>
      </div>
      <div className="departure-times" aria-label="Departure times">{choices.map(t=><button key={t.id} type="button" className={t.id===tripId?"active":""} onClick={()=>choose(t.id)}><strong>{t.departure}</strong><small>{tripBus(t,fleet).model} · {t.status}</small></button>)}{!choices.length&&<p>No departures for this route and date.</p>}</div>
      {(onAddDeparture || onDeleteDeparture) && <div className="departure-roster-actions">
        {onAddDeparture && <button type="button" className="secondary-button" disabled={busy} onClick={() => onAddDeparture(date, { routeId, busId: bus.layoutId || bus.id, arrival: trip.arrival, days: trip.days })}><Plus size={15}/> Add departure</button>}
        {onDeleteDeparture && selectedDeparture && <button type="button" className="danger-button" disabled={busy} onClick={() => setDepartureToRemove(selectedDeparture)}><Trash2 size={15}/> Remove {selectedDeparture.departure} departure</button>}
      </div>}
      <CounterDeparture key={`${runId}-${bus.id}-${bus.layoutId}-${bus.registration}-${bus.service}-${bus.seats}-${trip.departure}`} trip={trip} bus={bus} route={route} fleet={fleet} disabled={busy||date<today||!trip.active||!trip.days.includes(serviceDayFor(date))||["Departed","Returned","Cancelled"].includes(trip.status)} onDirty={setDepartureDirty} onSave={async changes=>{const saved=await onCounterSave(trip.id,date,changes);setDepartureDirty(false);setSelected([]);setFareEdits({});setFocusedId(null);return saved;}}/>
    </section>
    <DepartureControls key={`departure-${runId}`} trip={trip} bus={bus} date={date} reservedCount={reserved.size} onTransition={(action,notes,options)=>onTransition(trip.id,action,date,notes,options)}/>
    <div className="counter-main">
      <div className="counter-passenger-column"><section className="surface counter-passenger">
        {focused ? <div className="seat-inspector">
          <div className="panel-heading"><h2>Seat {seatList(focused.seats,focused.service)}</h2><button type="button" className="secondary-button" onClick={()=>{setFocusedId(null);setAction(null);}}>New passenger</button></div>
          <span className="status-pill">{focused.bookingStatus} · {focused.source} · {focused.gender}</span><h3>{focused.passenger}</h3><p>{focused.phone} · {focused.cnic}</p><p>{focused.ticketNo}</p>
          <div className="inspector-amount"><small>{focused.bookingStatus==="Reserved"?"To collect":"Net collected"}</small><strong>{money(focused.bookingStatus==="Reserved"?focused.balance:netCollected(focused))}</strong></div>
          <div className="counter-actions">
            {!readOnly&&focused.bookingStatus==="Reserved"&&<><button type="button" className="primary-button" disabled={paymentBlocked} aria-keyshortcuts="Enter" onClick={()=>setAction("payment")}>Collect payment & issue ticket</button><button type="button" className="danger-button" disabled={busy} onClick={async()=>{setBusy(true);try{await onCancel(focused.id);setFocusedId(null);}catch(e){showToast(e instanceof Error?e.message:"Could not remove reservation.");}finally{setBusy(false);}}}>Remove reservation</button><small>Reserved seats have no ticket or boarding token.</small></>}
            {focused.bookingStatus!=="Reserved"&&<button type="button" className="primary-button" onClick={()=>onPrint(focused)}><Printer size={16}/> {focused.bookingStatus==="Confirmed"?"Print receipt & token":"Print refund record"}</button>}
            {!readOnly&&focused.bookingStatus==="Confirmed"&&focused.paid===0&&<button type="button" className="danger-button" disabled={busy} onClick={async()=>{setBusy(true);try{await onCancel(focused.id);setFocusedId(null);}catch(e){showToast(e instanceof Error?e.message:"Could not cancel ticket.");}finally{setBusy(false);}}}>Cancel ticket & release seat</button>}
            {!readOnly&&refundableBalance(focused)>0&&<button type="button" className="danger-button" onClick={()=>setAction("refund")}>Cancel / refund ticket</button>}
            {!readOnly&&["Reserved","Confirmed"].includes(focused.bookingStatus)&&<button type="button" className="secondary-button" onClick={()=>setAction("edit")}>Edit passenger</button>}
          </div>
        </div> : readOnly?<p>Choose an occupied seat to view passenger details. Manage departure and seat availability using the controls above.</p>: <form ref={passengerForm} onSubmit={submit}>
          <div className="mode-tabs"><button type="button" className={mode==="Ticket"?"active":""} onClick={()=>setMode("Ticket")}>Paid ticket</button><button type="button" className={mode==="Reservation"?"active":""} onClick={()=>setMode("Reservation")}>Reserve</button></div>
          <fieldset disabled={busy} className="counter-fields"><legend className="sr-only">Passenger details</legend><div className="form-grid">
            <label className="span-2"><span>Passenger name *</span><input required maxLength={160} value={passenger.passenger} onChange={e=>update("passenger",e.target.value)} autoComplete="off"/></label>
            <label><span>Mobile *</span><input required maxLength={30} value={passenger.phone} onChange={e=>update("phone",e.target.value)}/></label>
            <label><span>CNIC / Passport{mode==="Ticket"?" *":" (optional)"}</span><input required={mode==="Ticket"} maxLength={50} value={passenger.cnic} onChange={e=>update("cnic",e.target.value)}/></label>
            <label><span>Gender{mode==="Ticket"?" *":" (optional)"}</span><select required={mode==="Ticket"} value={passenger.gender==="Unspecified"?"":passenger.gender} onChange={e=>update("gender",(e.target.value||"Unspecified") as PassengerForm["gender"])}><option value="">Select gender</option><option>Male</option><option>Female</option></select></label>
            <label><span>Boarding point</span><input value={passenger.boardingPoint} onChange={e=>update("boardingPoint",e.target.value)}/></label>
            {destinations.length>1&&<label className="span-2"><span>Destination</span><select value={destination} onChange={e=>{update("destination",e.target.value);setFareEdits({});}}>{destinations.map(d=><option key={d.name}>{d.name}</option>)}</select></label>}
            {mode === "Ticket" && <>
              {chosenSeats.length === 0 && <p className="span-2 fare-breakdown">Select seats to edit their fares.</p>}
              {chosenSeats.map((seat, index) => (
                <MoneyField
                  key={seat}
                  label={`Fare · Seat ${seatLabel(seat, bus.service)} · ${seatClass(bus, seat)}`}
                  value={fares[index]}
                  onChange={value => setFareEdits(current => ({ ...current, [seat]: value }))}
                  onClear={() => setFareEdits(current => ({ ...current, [seat]: undefined }))}
                />
              ))}
              <MoneyField label="Total discount" value={discount} onChange={value => update("discount", Math.min(value, fareTotal))} />
            </>}
            {mode==="Ticket"&&<><label><span>Payment</span><select value={passenger.paymentMethod} onChange={e=>update("paymentMethod",e.target.value as PaymentMethod)}><option>Cash</option><option>Bank transfer</option>{paymentMode!=="disabled"&&<option>1Bill</option>}</select></label>{passenger.paymentMethod!=="Cash"&&<label><span>Payment reference *</span><input required value={passenger.paymentReference} onChange={e=>update("paymentReference",e.target.value)}/></label>}</>}
          </div></fieldset>
          <div className="counter-total"><span>{chosenSeats.length ? `Seat ${seatList(chosenSeats,bus.service)}`:"Select seats"}<small>{mode==="Ticket"?"One ticket + token per seat":"Hold only · no ticket issued"}</small></span><strong>{money(total)}</strong></div>
          {departureDirty&&<p className="pending-departure" role="status">Save bus / time before issuing or reserving seats.</p>}{unavailable&&<p className="form-error">{trip.salesPaused?"Seat sales are paused. Resume sales above to continue.":"This departure is closed for booking."}</p>}{error&&<p className="form-error" role="alert">{error}</p>}
          <div className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={reset}>Clear</button><button type="submit" className="primary-button" disabled={paymentBlocked} aria-keyshortcuts={mode === "Ticket" ? "Enter" : undefined}>{busy?"Saving…":mode==="Ticket"?`Collect & issue ${chosenSeats.length>1?chosenSeats.length+" tickets":"ticket"}`:"Reserve seats"}</button></div>
        </form>}
      </section>
    <div className="seat-statistics" aria-label="Seat totals"><span className="booked"><small>Booked</small><strong>{occupied.size-reserved.size}</strong></span><span className="reserved"><small>Reserved</small><strong>{reserved.size}</strong></span><span><small>Available / {bus.seats} total</small><strong>{bus.seats-occupied.size}</strong></span></div>
      {destinations.length>1&&<div className="destination-statistics" aria-label="Passengers by destination">{destinations.map(d=><span key={d.name}>{d.name}<strong>{active.filter(b=>b.destination===d.name).reduce((sum,b)=>sum+b.seats.length,0)}</strong></span>)}</div>}
      </div><section className="surface counter-seats"><div className="panel-heading"><h2>{bus.model||bus.service}</h2><span>{vehicleLabel(bus)} · {trip.departure}</span></div>
        <SeatMap seatClasses={bus.seatClasses} locked={Boolean(unavailable||departureDirty)} seats={bus.seats} service={bus.service} selectedSeats={chosenSeats.filter(s=>!occupied.has(s))} occupied={occupied} reserved={reserved} female={new Set(active.filter(b=>b.gender==="Female").flatMap(b=>b.seats))} online={new Set(active.filter(b=>b.source==="Public web").flatMap(b=>b.seats))} onOccupied={seat=>{setFocusedId(active.find(b=>b.seats.includes(seat))!.id);setAction(null);}} onEnter={collectFromSeat} onSelect={seat=>{if(busy||unavailable||departureDirty)return;setFocusedId(null);if(selectionBasis!==selectionContext)setFareEdits({});setSelectionBasis(selectionContext);setSelected(chosenSeats.includes(seat)?chosenSeats.filter(s=>s!==seat):[...chosenSeats,seat].sort((a,b)=>a-b));}} large/>
        <div className="seat-refresh"><button className="secondary-button" type="button" disabled={refreshing} onClick={()=>void onRefresh()}><RefreshCw size={15} className={refreshing?"spin":""}/> Refresh seats</button><small>{refreshError||`Auto-updates every 5s${lastUpdated?" · Updated "+lastUpdated:""}`}</small></div>
        <p className="counter-hint">Click any booked or reserved seat to edit, collect payment, remove a reservation or refund. W = online; R = reserved.</p>
      </section>
    </div>
    <VoucherEditor readOnly={readOnly} key={`voucher-${runId}-${bus.id}-${bus.registration}-${trip.departure}`} trip={trip} bus={bus} route={route} net={net} records={records} onSave={changes=>onCounterSave(trip.id,date,changes)} onReport={kind=>onReport(kind,trip.id,trip.runNumber,date)}/>
    <section className="surface counter-history"><div className="panel-heading"><h2>Passenger & ticket history</h2><input aria-label="Find passenger or ticket" placeholder="Name, phone, ticket…" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="table-wrap"><table><thead><tr><th>Seat</th><th>Passenger</th><th>Status</th><th>Collected</th><th>Action</th></tr></thead><tbody>{records.filter(b=>`${b.passenger} ${b.phone} ${b.ticketNo}`.toLowerCase().includes(search.toLowerCase())).map(b=><tr key={b.id}><td>{seatList(b.seats,b.service)}</td><td><strong>{b.passenger}</strong><small>{b.ticketNo}</small></td><td><span className="status-pill">{b.bookingStatus}</span></td><td>{money(netCollected(b))}</td><td><button type="button" className="text-button" onClick={()=>{setFocusedId(b.id);document.querySelector(".counter-main")?.scrollIntoView({behavior:"smooth",block:"start"});}}>Manage</button></td></tr>)}</tbody></table></div></section>
    {focused&&action==="payment"&&<CollectPaymentModal booking={focused} route={route} bus={bus} paymentMode={paymentMode} onClose={()=>setAction(null)} onConfirm={async(method,reference,details)=>{await onConfirm(focused.id,method,reference,details);setAction(null);}}/>}
    {focused&&action==="refund"&&<RefundModal booking={focused} onClose={()=>setAction(null)} onRefund={onRefund}/>}
    {focused&&action==="edit"&&<BookingEditModal booking={focused} onClose={()=>setAction(null)} onSave={async b=>{await onUpdate(b);setAction(null);}}/>}
    {departureToRemove && onDeleteDeparture && <ConfirmDeleteModal
      title="Remove recurring departure?"
      item={`${routeLabel(route)} · ${trips.find(item => item.id === departureToRemove.id)?.departure ?? departureToRemove.departure}`}
      text="This removes the recurring time from the roster and stops future sales. Existing tickets and journey history are retained."
      onClose={() => setDepartureToRemove(null)}
      onConfirm={async () => {
        await onDeleteDeparture(departureToRemove.id);
        setDepartureToRemove(null);
        const next = choices.find(item => item.id !== departureToRemove.id);
        if (next) choose(next.id);
        else { reset(); setFocusedId(null); setDepartureDirty(false); }
      }}
    />}
  </div>;
}

function CounterDeparture({trip,bus,route,fleet,disabled,onDirty,onSave}:{trip:TripRecord;bus:BusRecord;route:RouteRecord;fleet:BusRecord[];disabled:boolean;onDirty:(dirty:boolean)=>void;onSave:(changes:CounterChanges)=>Promise<TripRun>}) {
  const layouts=fleet.filter(b=>!b.deleted&&b.isTemplate&&b.status!=="Retired");
  const currentLayout=bus.layoutId||bus.id;
  if(!layouts.some(b=>b.id===currentLayout))layouts.unshift(bus);
  const [layoutId,setLayoutId]=useState(currentLayout),[registration,setRegistration]=useState(bus.isTemplate?"":bus.registration),[departure,setDeparture]=useState(trip.departure),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [custom,setCustom]=useState(false);
  const changed=layoutId!==currentLayout||registration!==(bus.isTemplate?"":bus.registration)||departure!==trip.departure;
  const selectedLayout=layouts.find(b=>b.id===layoutId)||bus;
  const times=[...new Set([...departureTimes(route,selectedLayout), trip.departure])].sort();
  const markDirty=(id:string,reg:string,time:string)=>onDirty(id!==currentLayout||reg!==(bus.isTemplate?"":bus.registration)||time!==trip.departure);
  return <form className="counter-manual" onSubmit={async e=>{e.preventDefault();if(busy||disabled)return;setBusy(true);setError("");try{await onSave({registration,departure,layoutBusId:layoutId,expected:{registration:bus.isTemplate?"":bus.registration,departure:trip.departure,revision:trip.snapshot?.voucher?.revision??"",busId:bus.id}});}catch(e){setError(e instanceof Error?e.message:"Could not save departure.");}finally{setBusy(false);}}}>
    <label><span>Bus type</span><select value={layoutId} disabled={disabled||busy} onChange={e=>{setLayoutId(e.target.value);markDirty(e.target.value,registration,departure);setError("");}}>{layouts.map(b=><option key={b.id} value={b.id}>{b.model} · {b.seats} seats</option>)}</select></label>
    <label><span>Vehicle number (optional)</span><input aria-label="Vehicle number" value={registration} maxLength={30} disabled={disabled||busy} onChange={e=>{setRegistration(e.target.value);markDirty(layoutId,e.target.value,departure);}}/></label>
    <label><span>Actual departure · 24h</span><select aria-label="Departure time choices" disabled={disabled||busy} value={!custom&&times.includes(departure)?departure:"custom"} onChange={e=>{setCustom(e.target.value==="custom");if(e.target.value!=="custom"){setDeparture(e.target.value);markDirty(layoutId,registration,e.target.value);}}}>{times.map(time=><option key={time}>{time}</option>)}<option value="custom">Other time…</option></select>{(custom||!times.includes(departure))&&<input aria-label="Actual departure" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="HH:MM" value={departure} disabled={disabled||busy} onChange={e=>{setDeparture(e.target.value);markDirty(layoutId,registration,e.target.value);}} required/>}</label>
    <button className="secondary-button" disabled={disabled||busy||!changed}>{busy?"Saving…":"Save bus / time"}</button>
    {changed&&<p className="pending-departure" role="status">Save bus / time here to apply the seating plan and continue booking. Vehicle number can be added with the voucher.</p>}{error&&<p className="form-error" role="alert">{error}</p>}
  </form>;
}

function VoucherEditor({trip,bus,route,net,records,onSave,onReport,readOnly}:{readOnly:boolean;trip:TripRecord;bus:BusRecord;route:RouteRecord;net:number;records:Booking[];onSave:(changes:CounterChanges)=>Promise<TripRun>;onReport:(kind:ReportKind)=>void}) {
  const saved=trip.snapshot?.voucher;
  const policy=commissionPolicy(route,bus);
  const [draft,setDraft]=useState<Voucher>(()=>saved??{commissionRate:policy.rate,manualCommission:0,refreshments:0,terminalExpense:0,toll:0,misc:0,paidToDriver:0,driver:trip.driver,attendant:trip.attendant});
  const [registration,setRegistration]=useState(bus.isTemplate?'':bus.registration);
  const [revision,setRevision]=useState(saved?.revision??'');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const effective={...draft,...(policy.fixed?{commissionRate:policy.rate,manualCommission:0}:{})};
  const fields=[['commissionRate','Commission %'],['manualCommission','Additional commission'],['refreshments','Refreshments'],['terminalExpense','Terminal expense'],['toll','Toll / parchi'],['misc','Miscellaneous'],['paidToDriver','Paid to driver']] as const;
  const commission=Math.round(net*effective.commissionRate)/100+effective.manualCommission;
  const deductions=commission+draft.refreshments+draft.terminalExpense+draft.toll+draft.misc;
  const remaining=Math.round((net-deductions)*100)/100;
  const dirty=!saved||registration!==(bus.isTemplate?'':bus.registration)||fields.some(([key])=>saved[key]!==effective[key])||saved.driver!==draft.driver||saved.attendant!==draft.attendant||Math.abs((saved.basis??0)-net)>.005;
  const stale=revision!==(saved?.revision??'');
  const cash=records.reduce((sum,b)=>sum+(b.paymentMethod==='Cash'?b.paid:0)-(b.refunds??[]).filter(r=>r.method==='Cash').reduce((a,r)=>a+r.amount,0),0);
  return <details className="surface counter-voucher"><summary><span>Voucher summary</span><small>Vehicle, commission, crew & printing</small><ChevronRight size={18}/></summary><div className="voucher-content"><div className="panel-heading"><div><h2>Voucher summary</h2><p>{saved?`Saved · ${formatPrintTime(saved.savedAt)}`:'Enter vehicle, deductions and crew, then save to print.'}</p></div><button type="button" className="secondary-button" onClick={()=>onReport('cnic')}><FileText size={16}/> Passenger / CNIC sheet</button></div>
    <form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const updated=await onSave({registration,departure:trip.departure,layoutBusId:bus.layoutId||bus.id,voucher:effective,expected:{registration:bus.isTemplate?'':bus.registration,departure:trip.departure,revision,busId:bus.id}});setRevision(updated.snapshot!.voucher!.revision!);setDraft(updated.snapshot!.voucher!);}catch(e){setError(e instanceof Error?e.message:'Voucher could not be saved.');}finally{setBusy(false);}}}>
      <fieldset disabled={busy||readOnly} className="counter-fields"><div className="voucher-fields"><label><span>Vehicle number *</span><input aria-label="Voucher vehicle number" required maxLength={30} value={registration} onChange={e=>setRegistration(e.target.value)}/></label>{fields.filter(([key])=>!(policy.fixed&&key==='manualCommission')).map(([key,label])=><label key={key}><span>{label}{key==='commissionRate'&&policy.fixed?' · fixed in management':''}</span><input type="number" min="0" max={key==='commissionRate'?100:10000000} step="0.01" value={effective[key]} readOnly={policy.fixed&&key==='commissionRate'} onChange={e=>setDraft({...draft,[key]:Number(e.target.value)})}/></label>)}<label><span>Driver</span><input value={draft.driver} maxLength={120} onChange={e=>setDraft({...draft,driver:e.target.value})}/></label><label><span>Hostess</span><input value={draft.attendant} maxLength={120} onChange={e=>setDraft({...draft,attendant:e.target.value})}/></label></div></fieldset>
      <div className="voucher-calculation"><span>Collected after refunds <strong>{money(net)}</strong></span><span>Commission <strong>{money(commission)}</strong></span><span>Total deductions <strong>{money(deductions)}</strong></span><span>Total remaining <strong>{money(remaining)}</strong></span></div>
      <p className="counter-hint">Total remaining includes all payment methods after refunds, commission and expenses.{(cash!==net||draft.paidToDriver>0)&&` Cash in hand: ${money(cash-deductions-draft.paidToDriver)} (cash receipts minus cash refunds, deductions and driver handover).`}</p>
      {stale&&<p className="form-error">A newer voucher is saved. <button type="button" onClick={()=>{setDraft(saved!);setRevision(saved!.revision!);setError('');}}>Load saved voucher</button></p>}{error&&<p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="primary-button" disabled={busy||stale||readOnly}>{busy?'Saving…':'Save voucher'}</button><button type="button" className="secondary-button" disabled={dirty||stale||busy} onClick={()=>onReport('terminal-a4')}><Printer size={16}/> Voucher / PDF</button><button type="button" className="secondary-button" disabled={dirty||stale||busy} onClick={()=>onReport('terminal-thermal')}>80mm voucher</button></div>
    </form>
  </div></details>;
}

function MoneyField({
  label,
  value,
  onChange,
  onClear,
}: {
  label: string;
  value: number;
  onChange?: (value: number) => void;
  onClear?: () => void;
}) {
  const policy=useStaffPolicy();
  const locked=!onChange || (label.startsWith("Fare") && policy?.staffCanEditFare===false) || (label.toLowerCase().includes("discount") && policy?.staffCanDiscount===false);
  return (
    <label>
      <span>{label}</span>
      <div className="money-input">
        <b>PKR</b>
        <input
          type="number"
          readOnly={locked}
          min="0"
          step="0.01"
          value={value}
          onChange={event => {
            if (event.target.value === "" && onClear) onClear();
            else onChange?.(Number(event.target.value));
          }}
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
            <span>CNIC / Passport{booking.bookingStatus==="Reserved"?" (optional)":" *"}</span>
            <input
              required={booking.bookingStatus!=="Reserved"}
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
              {booking.bookingStatus==="Reserved"&&<option>Unspecified</option>}
              <option>Male</option>
              <option>Female</option>
            </select>
          </label>
          <label>
            <span>Destination</span>
            <input
              value={draft.destination}
              readOnly
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
  const policy=useStaffPolicy();
  const available = refundableBalance(booking);
  const maximum=policy?.staffCanRefund===false?0:Math.max(0,Math.min(available,policy?booking.paid*policy.staffMaxRefundPercent/100-refundedTotal(booking):available,policy?.staffMaxRefundAmount||available));
  const [amount, setAmount] = useState(maximum);
  const [method, setMethod] = useState<PaymentMethod>(booking.paymentMethod === "Card" ? "Bank transfer" : booking.paymentMethod);
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
          if (!Number.isFinite(amount) || amount <= 0 || amount > maximum) {
            setError(`Enter an amount between PKR 1 and ${money(available)}.`);
            return;
          }
          if (method !== "Cash" && !reference.trim()) {
            setError("Enter the refund transaction reference.");
            return;
          }
          if (busy) return;
          setBusy(true);
          try { await onRefund(booking.id, {
            id: "",
            amount,
            releaseSeats,
            method,
            reason,
            reference:
              reference.trim(),
            notes: notes.trim(),
            processedAt: "",
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
              max={maximum}
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
              {(["Cash", "1Bill", "Bank transfer"] as PaymentMethod[]).map(
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
        {policy && maximum<available && <p className="form-error">Staff refund limit for this ticket: {money(maximum)}. Ask an administrator for a higher refund.</p>}
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>
            Keep booking
          </button>
          <button className="danger-button" type="submit" disabled={busy || maximum<=0}>
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
  onUpdate: (booking: Booking) => Promise<void>;
  onRefund: (id: string, refund: RefundTransaction) => Promise<void>;
  canEdit: boolean;
  canRefund: boolean;
}) {
  const [range,setRange]=useState<DateRange>({from:"",to:""});
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState<"All" | BookingSource>("All"),
    [editing, setEditing] = useState<Booking | null>(null),
    [refunding, setRefunding] = useState<Booking | null>(null);
  const visible = bookings.filter(
    (b) =>
      inDateRange(b.date,range) && b.paid > 0 &&
      b.bookingStatus !== "Reserved" &&
      (filter === "All" || b.source === filter) &&
      `${b.ticketNo} ${b.passenger} ${b.phone} ${b.cnic} ${b.route} ${(b.refunds ?? [])
        .map((refund) => `${presentationText(refund.reference)} ${refund.reason}`)
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
        <DateRangeFilter value={range} onChange={setRange}/>
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
          onSave={async (booking) => {
            await onUpdate(booking);
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
  trips,runs,routes,fleet,
  bookings,
  onConfirm,
  onCancel,
  onNew,
  paymentMode,
}: {
  trips:TripRecord[];runs:TripRun[];routes:RouteRecord[];fleet:BusRecord[];
  bookings: Booking[];
  onConfirm: (id: string, method: PaymentMethod, reference: string, details?: Partial<Booking>) => Promise<void>;
  onCancel: (id: string) => void;
  onNew: () => void;
  paymentMode: string;
}) {
  const [range,setRange]=useState<DateRange>({from:"",to:""});
  const [collecting, setCollecting] = useState<Booking | null>(null);
  const reservations = bookings.filter((b) => b.bookingStatus === "Reserved" && inDateRange(b.date,range));
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
        <DateRangeFilter value={range} onChange={setRange}/>
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
          route={routes.find(r=>r.id===trips.find(t=>t.id===collecting.tripId)?.routeId)}
          bus={runs.find(r=>r.id===collecting.tripRunId)?.snapshot?.bus||fleet.find(b=>b.id===trips.find(t=>t.id===collecting.tripId)?.busId)}
          paymentMode={paymentMode}
          onClose={() => setCollecting(null)}
          onConfirm={async (method, reference, details) => {
            await onConfirm(collecting.id, method, reference, details);
            setCollecting(null);
          }}
        />
      )}
    </div>
  );
}

function CollectPaymentModal({
  route, bus,
  booking,
  paymentMode,
  onClose,
  onConfirm,
}: {
  route?:RouteRecord; bus?:BusRecord;
  booking: Booking;
  paymentMode: string;
  onClose: () => void;
  onConfirm: (method: PaymentMethod, reference: string, details?: Partial<Booking>) => Promise<void>;
}) {
  const [details,setDetails]=useState({...booking,discount:0});
  const [fareOverride, setFareOverride] = useState<number>();
  const stops=route?routeDestinations(route):[{name:booking.destination,fare:booking.fare}];
  const baseFares = booking.seats.map(seat =>
    route && bus ? seatFare(route, bus, details.destination, seat) : booking.fare,
  );
  const fares = baseFares.map(fare => fareOverride ?? fare);
  const fareTotal = fares.reduce((sum, fare) => sum + fare, 0);
  const discount = Math.min(details.discount, fareTotal);
  const total = Math.round((fareTotal - discount) * 100) / 100;
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const field = form.current?.querySelector<HTMLElement>("input:invalid, select:invalid, button[type=submit]");
    field?.focus();
  }, []);
  return (
    <div className="form-modal-overlay" role="dialog" aria-modal="true" aria-label="Collect reservation payment">
      <form ref={form} className="form-modal compact-modal" onKeyDown={event => {
        if (event.key === "Enter" && event.repeat) event.preventDefault();
      }} onSubmit={async (event) => {
        event.preventDefault();
        if (method !== "Cash" && !reference.trim()) {
          setError("Enter the verified payment reference.");
          return;
        }
        if (busy) return;
        setBusy(true);
        try {
          await onConfirm(method, reference.trim(), {
            ...details,
            discount,
            fareOverrides: fareOverride === undefined ? undefined : booking.seats.map(() => fareOverride),
          });
        }
        catch (error) { setError(error instanceof Error ? error.message : "Payment could not be recorded."); }
        finally { setBusy(false); }
      }}>
        <header>
          <div>
            <h2>Collect {money(total)}</h2>
            <p>{booking.ticketNo} · {booking.passenger} · Seats {seatList(booking.seats, booking.service)}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}><X size={19} /></button>
        </header>
        <div className="modal-form-grid">
          <label><span>Passenger name *</span><input required maxLength={160} value={details.passenger} onChange={e=>setDetails({...details,passenger:e.target.value})}/></label>
          <label><span>Mobile *</span><input required maxLength={30} value={details.phone} onChange={e=>setDetails({...details,phone:e.target.value})}/></label>
          <label><span>CNIC / Passport *</span><input required maxLength={50} value={details.cnic} onChange={e=>setDetails({...details,cnic:e.target.value})}/></label>
          <label><span>Gender *</span><select required value={details.gender==='Unspecified'?'':details.gender} onChange={e=>setDetails({...details,gender:e.target.value as Booking['gender']})}><option value="">Select gender</option><option>Male</option><option>Female</option></select></label>
          {stops.length>1&&<label><span>Destination</span><select value={details.destination} onChange={e=>{setDetails({...details,destination:e.target.value});setFareOverride(undefined);}}>{stops.map(stop=><option key={stop.name}>{stop.name}</option>)}</select></label>}
          <label><span>Boarding point</span><input value={details.boardingPoint} onChange={e=>setDetails({...details,boardingPoint:e.target.value})}/></label>
          <MoneyField
            label="Fare per seat"
            value={Math.round(fareTotal * 100 / booking.seats.length) / 100}
            onChange={setFareOverride}
            onClear={() => setFareOverride(undefined)}
          />
          <MoneyField label="Discount" value={discount} onChange={value => setDetails({ ...details, discount: Math.min(value, fareTotal) })} />

          <label className="span-2">
            <span>Payment method</span>
            <select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
              <option>Cash</option>
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
          <button className="primary-button" type="submit" disabled={busy} aria-keyshortcuts="Enter"><ReceiptText size={16} /> Issue paid ticket</button>
        </footer>
      </form>
    </div>
  );
}

function TripsView({
  bookings, trips, fleet, routes, runs, onSell, onSave, onDelete, onReport,
}: {
  bookings: Booking[]; trips: TripRecord[]; fleet: BusRecord[]; routes: RouteRecord[];
  runs: TripRun[]; onSell: (id: string, date: string) => void;
  onSave: (trip: TripRecord) => Promise<void>; onDelete: (id: string) => Promise<void>;
  onReport: (kind: ReportKind, tripId: string, run: number, date?: string) => void;
}) {
  const [editing, setEditing] = useState<TripRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<TripRecord | null>(null);
  const [openTrip, setOpenTrip] = useState<{ id: string; date: string } | null>(null);
  const [serviceDate, setServiceDate] = useState(today);
  const [range,setRange]=useState<DateRange>({from:"",to:""});
  const [filter, setFilter] = useState("This date");
  const visible = filter === "This date"
    ? tripsOnDate(trips, serviceDate, runs).map((trip) => ({ trip, date: serviceDate }))
    : runs.filter((run) => (filter === "Departed" ? run.status === "Departed" : ["Departed", "Returned"].includes(run.status)) && inDateRange(run.date,range))
      .flatMap((run) => { const trip = trips.find((item) => item.id === run.tripId); return trip ? [{ trip: tripOnDate(trip, run.date, runs), date: run.date }] : []; });
  const modalTrip = openTrip && trips.find((trip) => trip.id === openTrip.id);
  return (
    <div className="admin-view">
      <ViewHeading eyebrow="" title="Roster" text="Edit schedules here. Manage seats and departure from the ticket page."
        action={<button className="primary-button" type="button" disabled={!routes.length || !fleet.length} onClick={() => setEditing("new")}><Plus size={16} /> Add schedule</button>} />
      <section className="surface data-surface">
        <div className="data-toolbar">
          <div className="date-switcher"><label><CalendarDays size={17}/><span>Service date</span><input type="date" value={serviceDate} onChange={(event) => { setServiceDate(event.target.value); setFilter("This date"); }}/></label></div>
          <div className="filter-tabs">{["This date", "Departed", "History"].map((label) => <button type="button" key={label} className={filter === label ? "active" : ""} onClick={() => setFilter(label)}>{label}</button>)}</div>
        </div>
        {filter!=="This date"&&<DateRangeFilter value={range} onChange={setRange}/>}
        <div className="trip-cards" role="table" aria-label="Departures">
          <div className="trip-table-head" role="row"><span>Time</span><span>Route</span><span>Bus</span><span>Crew</span><span>Seats</span><span>Status</span><span>Actions</span></div>
          {visible.map(({trip, date}) => {
            const bus = tripBus(trip, fleet), route = tripRoute(trip, routes);
            if (!bus || !route) return null;
            const records = bookings.filter((booking) => booking.tripRunId === tripRunKey(trip, trip.runNumber, date));
            const paid = records.filter((booking) => booking.bookingStatus === "Confirmed").reduce((sum, booking) => sum + booking.seats.length, 0);
            const held = records.filter((booking) => booking.bookingStatus === "Reserved").reduce((sum, booking) => sum + booking.seats.length, 0);
            return <article key={trip.id + date} role="row">
              <div className="trip-card-time"><strong>{trip.departure}</strong><small>{date}</small></div>
              <div className="trip-card-route"><div><strong>{routeLabel(route)}</strong><small>{trip.active ? trip.days.join(" · ") : "Schedule paused"}</small></div></div>
              <div><strong>{bus.isTemplate?bus.model:bus.registration}</strong><small>{bus.service} · {bus.seats} seats</small></div>
              <div><strong>{trip.driver}</strong><small>{trip.attendant}</small></div>
              <div><strong>{paid} paid · {held} held</strong><small>{bus.seats - paid - held} available</small></div>
              <div><b className={`plain-status ${trip.status.toLowerCase()}`}>{trip.status}</b>{trip.departedAt && <small>Left {formatPrintTime(trip.departedAt)}</small>}</div>
              <div className="trip-actions">
                <button className="text-action" type="button" onClick={() => setOpenTrip({id: trip.id, date})}>Passengers</button>
                <button className="text-action" type="button" onClick={() => onSell(trip.id, date)}>Ticket page</button>
                <button className="text-action" type="button" disabled={trip.deleted} onClick={() => setEditing(trips.find((item) => item.id === trip.id) ?? trip)}>Edit</button>
                <button className="icon-action danger" type="button" disabled={trip.deleted} aria-label={`Delete ${routeLabel(route)} trip`} onClick={() => setDeleting(trip)}><Trash2 size={15}/></button>
              </div>
            </article>;
          })}
          {!visible.length && <EmptyState title="No departures" text={filter === "Departed" ? "No departed services in this date range." : "Select another date or add a schedule."}/>}
        </div>
      </section>
      {editing && <TripFormModal trip={editing === "new" ? undefined : editing} fleet={fleet} routes={routes} onClose={() => setEditing(null)} onSave={async (trip) => { await onSave(trip); setEditing(null); }}/>}
      {deleting && <ConfirmDeleteModal title="Delete schedule?" item={`${routeLabel(tripRoute(deleting,routes))} · ${deleting.departure}`} text="Remove this schedule from the roster and stop future sales. Existing tickets, refunds and journey history are retained." onClose={() => setDeleting(null)} onConfirm={async () => { await onDelete(deleting.id); setDeleting(null); }}/>}
      {modalTrip && openTrip && <TripRunModal trip={tripOnDate(modalTrip, openTrip.date, runs)} fleet={fleet} bookings={bookings} routes={routes} serviceDate={openTrip.date} onClose={() => setOpenTrip(null)} onReport={onReport}/>}
    </div>
  );
}

function DepartureControls({trip,date,reservedCount,onTransition}:{trip:TripRecord;bus:BusRecord;date:string;reservedCount:number;onTransition:(action:DepartureAction,notes?:string,options?:DepartureOptions)=>Promise<void>}) {
  const [action,setAction]=useState<DepartureAction|null>(null),[notes,setNotes]=useState(""),[resolve,setResolve]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const labels:Record<DepartureAction,string>={pause:"Pause seat sales",resume:"Resume seat sales",depart:"Bus gone · close tickets",reopen:"Reopen counter sales",'close-sales':"Close counter sales"};
  const open=(next:DepartureAction)=>{setAction(next);setNotes("");setResolve(false);setError("");};
  const closed=["Departed","Returned","Cancelled"].includes(trip.status);
  return <section className="departure-controls surface"><div><strong>{trip.salesPaused?"Seat sales paused":trip.salesOverride?"Counter sales override active":closed?"Tickets closed":"Seat sales open"}</strong><small>{trip.status} · {date}</small></div><div className="departure-buttons">
    {!closed&&!trip.deleted&&<><button className="secondary-button" disabled={date<today} onClick={()=>open(trip.salesPaused?"resume":"pause")}>{trip.salesPaused?"Resume seats":"Pause seats"}</button><button className="primary-button" disabled={date!==today} onClick={()=>open("depart")}>Bus gone · close tickets</button></>}
    {trip.status==="Departed"&&<><button className="secondary-button" disabled={date!==today||trip.deleted} onClick={()=>open(trip.salesOverride?"close-sales":"reopen")}>{trip.salesOverride?"Close counter sales":"Reopen counter sales"}</button></>}
  </div>{action&&<div className="form-modal-overlay" role="dialog" aria-modal="true" aria-label={labels[action]}><form className="form-modal compact-modal" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);try{await onTransition(action,notes,{confirm:true,resolveReservations:resolve});setAction(null);}catch(e){setError(e instanceof Error?e.message:"Could not update departure.");}finally{setBusy(false);}}}>
    <header><h2>{labels[action]}</h2><button type="button" disabled={busy} aria-label="Close" onClick={()=>setAction(null)}><X size={18}/></button></header>
    <div className="modal-form-grid"><p className="span-2">{action==="depart"?"This records the departure and closes its seat map to new sales.":action==="reopen"?"Allow counter staff to issue additional tickets after departure. The public website stays closed. This override and your reason are recorded.":action==="pause"?"Temporarily stop new bookings from the counter and website. Existing passenger records remain available.":"Confirm this change for the selected departure."}</p>
    {action==="depart"&&reservedCount>0&&<label className="span-2 checkbox-label"><input type="checkbox" checked={resolve} onChange={e=>setResolve(e.target.checked)}/><span>Release {reservedCount} unpaid reserved seat(s) and close tickets</span></label>}
    {(action==="reopen"||action==="depart")&&<label className="span-2"><span>{action==="reopen"?"Reason for reopening *":"Note (optional)"}</span><textarea required={action==="reopen"} minLength={action==="reopen"?5:undefined} maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>}</div>
    {error&&<p className="form-error" role="alert">{error}</p>}<footer><button type="button" className="secondary-button" disabled={busy} onClick={()=>setAction(null)}>Cancel</button><button className="primary-button" disabled={busy}>{busy?"Saving…":"Confirm"}</button></footer>
  </form></div>}</section>;
}

function FleetView({fleet,onSave,onDelete}:{fleet:BusRecord[];onSave:(bus:BusRecord)=>Promise<void>;onDelete:(id:string)=>Promise<void>}) {
  const [editing,setEditing]=useState<BusRecord|"new"|null>(null),[deleting,setDeleting]=useState<BusRecord|null>(null);
  const layouts=fleet.filter(b=>!b.deleted&&b.isTemplate);
  return <div className="admin-view"><ViewHeading eyebrow="BUS LAYOUTS" title="Buses" text="Save the bus name and seating plan here. Enter its vehicle number on the ticket page." action={<button className="primary-button" onClick={()=>setEditing("new")}><Plus size={16}/> Add bus layout</button>}/>
    <section className="fleet-grid">{layouts.map(bus=><article className="surface fleet-card" key={bus.id}><div className="fleet-card-top"><span><BusFront size={20}/></span><strong>{bus.model}</strong></div><p>{bus.service} · {bus.seats} seats</p><div className="fleet-card-actions"><button onClick={()=>setEditing(bus)}>Edit layout <ChevronRight size={15}/></button><button className="danger-text-button" onClick={()=>setDeleting(bus)}><Trash2 size={15}/> Delete</button></div></article>)}</section>
    {!layouts.length&&<EmptyState title="No bus layouts" text="Add a name, bus type and seat capacity to get started."/>}
    {editing&&<BusFormModal bus={editing==="new"?undefined:editing} onClose={()=>setEditing(null)} onSave={async bus=>{await onSave(bus);setEditing(null);}}/>}
    {deleting&&<ConfirmDeleteModal title="Delete bus layout?" item={deleting.model} text="This removes the layout and its recurring schedules from the working lists. Saved tickets and journey history remain available." onClose={()=>setDeleting(null)} onConfirm={async()=>{await onDelete(deleting.id);setDeleting(null);}}/>}
  </div>;
}

function TripFormModal({
  trip,
  defaults,
  fleet,
  routes,
  onClose,
  onSave,
}: {
  trip?: TripRecord;
  defaults?: Partial<TripRecord>;
  fleet: BusRecord[];
  routes: RouteRecord[];
  onClose: () => void;
  onSave: (trip: TripRecord) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const activeRoutes = routes.filter(route => !route.deleted && route.status === "Active");
  const layouts = fleet.filter(bus => !bus.deleted && bus.isTemplate && bus.status !== "Retired");
  const [draft, setDraft] = useState<TripRecord>(
    trip ?? {
      id: "new-trip",
      departure: "08:00",
      arrival: "14:00",
      driver: "",
      attendant: "",
      platform: "P-01",
      status: "Scheduled",
      days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      active: true,
      runNumber: 1,
      ...defaults,
      routeId: activeRoutes.find(route => route.id === defaults?.routeId)?.id ?? activeRoutes[0]?.id ?? "",
      busId: layouts.find(bus => bus.id === defaults?.busId)?.id ?? layouts.find(bus => bus.status === "Ready")?.id ?? layouts[0]?.id ?? "",
    },
  );
  const update = <K extends keyof TripRecord>(key: K, value: TripRecord[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.days.length) return setError("Select at least one running day.");
    if (!draft.busId) return setError("Choose a bus layout.");
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
              {activeRoutes.map((route) => (
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
              required
              value={draft.departure}
              onChange={(event) => update("departure", event.target.value)}
            />
          </label>
          <label>
            <span>Arrival</span>
            <input
              type="time"
              required
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
              {layouts.map((bus) => (
                  <option value={bus.id} key={bus.id}>
                    {bus.model} · {bus.seats} seats
                  </option>
                ))}
            </select>
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

function BusFormModal({bus,onClose,onSave}:{bus?:BusRecord;onClose:()=>void;onSave:(bus:BusRecord)=>Promise<void>}) {
  const [draft,setDraft]=useState<BusRecord>(bus??{id:"new",registration:"",model:"",service:"Standard Plus",seats:49,year:new Date().getFullYear(),status:"Ready",nextService:"Not scheduled",isTemplate:true});
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  return <div className="form-modal-overlay" role="dialog" aria-modal="true" aria-label={bus?"Edit bus layout":"Add bus layout"}><form className="form-modal compact-modal" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onSave({...draft,isTemplate:true});}catch(e){setError(e instanceof Error?e.message:"Could not save layout.");}finally{setBusy(false);}}}>
    <header><div><h2>{bus?"Edit bus layout":"Add bus layout"}</h2><p>Vehicle registration is entered on the ticket page.</p></div><button type="button" aria-label="Close" onClick={onClose}><X size={18}/></button></header><div className="modal-form-grid">
    <label className="span-2"><span>Bus name *</span><input required maxLength={120} value={draft.model} onChange={e=>setDraft({...draft,model:e.target.value})} placeholder="Standard Plus 49"/></label>
    <label><span>Bus type</span><select value={draft.service} onChange={e=>setDraft({...draft,service:e.target.value,seats:e.target.value==="Sleeper Bus"?35:draft.seats})}>{["Standard Plus","Executive","Sleeper Bus","Business Class","Premium Plus"].map(t=><option key={t}>{t}</option>)}</select></label>
    <label><span>Seats</span><input type="number" min="1" max="100" step="1" required value={draft.seats} onChange={e=>setDraft({...draft,seats:Number(e.target.value)})}/></label>
    <label className="span-2"><span>Fixed commission % (0 = enter on voucher)</span><input type="number" min="0" max="100" step="0.01" value={draft.commissionRate??0} onChange={e=>setDraft({...draft,commissionRate:Number(e.target.value)})}/></label>
    <div className="span-2 management-repeater"><strong>Seat classes</strong>{(draft.seatClasses||[]).map((group,index)=><div className="class-row" key={index}><label><span>Class name</span><input required value={group.name} onChange={e=>setDraft({...draft,seatClasses:draft.seatClasses!.map((g,i)=>i===index?{...g,name:e.target.value}:g)})}/></label><label><span>Seats (comma separated)</span><input required defaultValue={group.seats.join(',')} onBlur={e=>setDraft({...draft,seatClasses:draft.seatClasses!.map((g,i)=>i===index?{...g,seats:e.target.value.split(',').map(v=>Number(v.trim()))}:g)})}/></label><button type="button" aria-label={`Remove ${group.name} class`} onClick={()=>setDraft({...draft,seatClasses:draft.seatClasses!.filter((_,i)=>i!==index)})}><X size={16}/></button></div>)}<button type="button" className="text-action" onClick={()=>setDraft({...draft,seatClasses:[...(draft.seatClasses||[]),{name:'',seats:[]}]})}>+ Add seat class</button><small>Seats without a class use the Standard fare. Example: Business seats 1–12; Executive seats 13–41.</small></div></div>
    {error&&<p className="form-error">{error}</p>}<footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy?"Saving…":"Save layout"}</button></footer>
  </form></div>;
}

function TripRunModal({
  trip,
  fleet,
  bookings,
  routes,
  serviceDate,
  onClose,
  onReport,
}: {
  trip: TripRecord;
  fleet: BusRecord[];
  bookings: Booking[];
  routes: RouteRecord[];
  serviceDate: string;
  onClose: () => void;
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
              {serviceDate} · {vehicleLabel(bus)} · Run {trip.runNumber} ·{" "}
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
        {trip.notes && <p className="system-note">{presentationText(trip.notes)}</p>}
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
        {options.map((item) => <option value={item.id} key={item.id}>{item.departure} · {vehicleLabel(tripBus(item,fleet))} · {tripRoute(item,routes) ? routeLabel(tripRoute(item,routes)) : ""} · {item.status}</option>)}
      </select></label>
      <label><span>Previous departures</span><select value="" onChange={(event) => {const run = runs.find((item) => item.id === event.target.value);if(run){setReportDate(run.date);setTripId(run.tripId);}}}>
        <option value="">Choose a recorded departure</option>{history.map((run) => <option key={run.id} value={run.id}>{run.date} · {vehicleLabel(run.snapshot?.bus)} · {run.snapshot?.route.from} → {run.snapshot?.route.to} · {run.status}</option>)}
      </select></label>
      {trip && bus && route && <div className="report-trip-summary"><span><small>Bus</small><strong>{vehicleLabel(bus)}</strong></span><span><small>Route</small><strong>{routeLabel(route)}</strong></span><span><small>Status</small><strong>{trip.status}</strong></span><span><small>Tickets</small><strong>{records.length}</strong></span></div>}
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
  const documentRef = useRef<HTMLElement>(null);
  const printRun = useRef<AbortController | null>(null);
  useEffect(() => () => printRun.current?.abort(), []);
  const [printedAt, setPrintedAt] = useState(() => new Date());
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");
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
  const ledgerRecords = records.filter(booking=>booking.paid>0||booking.bookingStatus==="Confirmed").sort((a,b)=>a.seats[0]-b.seats[0]);
  const printedBookings = voucher ? ledgerRecords : report.kind === "cnic" ? runBookings : [...runBookings, ...records.filter((booking) => booking.bookingStatus === "Reserved")];
  const rows = printedBookings.flatMap((booking) =>
    booking.seats.map((seat) => ({ booking, seat })),
  );
  const total = gross - refunds;
  const savedVoucher = trip.snapshot?.voucher;
  const policy=commissionPolicy(route,bus);
  const voucherStale = voucher && (!savedVoucher || bus.isTemplate || (policy.fixed && (savedVoucher.commissionRate!==policy.rate||savedVoucher.manualCommission!==0)) || Math.abs((savedVoucher.basis ?? 0) - total) > .005);
  const totals: (string | number)[][] = [["Tickets issued", ledgerRecords.length], ["Payments received",money(gross)]];
  if (refunds) totals.push(["Refunds",money(refunds)]);
  totals.push(["Net collected",money(total)]);
  if (savedVoucher) {
    totals.push([`Commission (${savedVoucher.commissionRate}%)`,money(savedVoucher.commission ?? 0)]);
    for (const [label,value] of [["Terminal expense",savedVoucher.terminalExpense],["Refreshments",savedVoucher.refreshments],["Toll / parchi",savedVoucher.toll],["Miscellaneous",savedVoucher.misc]] as const) if(value) totals.push([label,money(value)]);
    totals.push(["Total deductions",money(savedVoucher.deductions??0)]);
    if(savedVoucher.paidToDriver) totals.push(["Paid to driver",money(savedVoucher.paidToDriver)]);
    totals.push(["Total remaining",money(total-(savedVoucher.deductions??0))]);
    if(savedVoucher.paidToDriver) totals.push(["After driver handover",money(total-(savedVoucher.deductions??0)-savedVoucher.paidToDriver)]);
    if(report.kind!=="terminal-thermal" && Math.abs(methodTotal('Cash')-total)>.005) totals.push(["Cash in hand only",money(methodTotal('Cash')-(savedVoucher.deductions??0)-savedVoucher.paidToDriver)]);
  }

  const title = {
    manifest: "Bus Detail",
    cnic: "Passenger CNIC Sheet",
    "terminal-a4": "Terminal Voucher Report",
    "terminal-thermal": "Terminal Voucher",
  }[report.kind];
  const thermal = report.kind === "terminal-thermal";
  const printReport = async () => {
    if (!documentRef.current || printRun.current) return;
    const run = new AbortController();
    printRun.current = run;
    setPrinting(true);
    setPrintError("");
    try {
      flushSync(() => setPrintedAt(new Date()));
      const source = documentRef.current;
      if (!source) return;
      await printDocument(source.cloneNode(true) as HTMLElement, {
        title,
        width: thermal ? "80mm" : voucher ? "210mm" : "297mm",
        pageCss: thermal
          ? body => `@page { size: 80mm ${Math.ceil(body.firstElementChild!.scrollHeight * 25.4 / 96) + 2}mm; margin: 0; }`
          : `@page { size: A4 ${voucher ? "portrait" : "landscape"}; margin: 8mm; }`,
        signal: run.signal,
      });
    } catch {
      if (!run.signal.aborted) setPrintError("The browser could not open this report for printing. Try again.");
    } finally {
      printRun.current = null;
      if (!run.signal.aborted) setPrinting(false);
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
              {thermal ? "80mm thermal printer" : voucher?"A4 portrait":"A4 landscape"} ·{" "}
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
        {printError && <p className="form-error" role="alert">{printError}</p>}
        <article ref={documentRef}
          className={`print-document operations-document document-${report.kind} ${rows.length>50?"document-dense":""} ${thermal ? "report-thermal" : voucher ? "report-a4" : "report-a4 report-landscape"}`}
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
              <strong>{vehicleLabel(bus)}</strong>
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
                {vehicleLabel(bus)} · {bus.service}
              </strong>
            </span>
            {!voucher&&<span>
              <small>Status / Platform</small>
              <strong>
                {trip.status} · {trip.platform}
              </strong>
            </span>}
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
              <h3 className="document-section-title">Seat · Passenger · Net PKR</h3>
              {rows.map(({booking,seat})=><div className="thermal-passenger" key={`${booking.id}-${seat}`}><span><b>{seatLabel(seat,booking.service)}</b><strong>{booking.passenger}{routeDestinations(route).length>1&&<small> · {booking.destination}</small>}</strong><b>{Math.round(netCollected(booking)/booking.seats.length).toLocaleString('en-PK')}{refundedTotal(booking)>0?' R':''}</b></span></div>)}
              {!rows.length && (
                <p className="document-empty">No passengers in this run.</p>
              )}
              <h3 className="document-section-title">Collection summary</h3>
              <div className="thermal-total">{totals.map(([label, value]) => <span className={label === "Total remaining" ? "document-grand-total" : undefined} key={label}>{label}<b>{value}</b></span>)}</div>
            </>
          ) : report.kind === "terminal-a4" ? (
            <>
              <h3 className="document-section-title">Ticket &amp; payment register</h3>
              <table className="document-table">
                <colgroup>{[17, 8, 25, 14, 6, 10, 20].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Time</th>
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
                      <td>{booking.ticketNo}{refundedTotal(booking)>0&&<small>Refund</small>}</td>
                      <td>
                        {ticketTime(new Date(booking.seatPrintedAt ?? booking.createdAt))}
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
              <div className="voucher-summary-grid">{totals.map(([label,value]) => <span className={label === "Total remaining" ? "document-grand-total" : undefined} key={label}><small>{label}</small><strong>{value}</strong></span>)}</div>
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
                      <th>Phone number</th>
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
                      <td>{booking.phone}</td>
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
          {!voucher && <p className="document-empty">Passengers: {rows.length} · {trip.departedAt ? `Departed ${formatPrintTime(trip.departedAt)}` : "Before departure"}</p>}
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

function RouteFormModal({route,fleet,onClose,onSave}:{route?:RouteRecord;fleet:BusRecord[];onClose:()=>void;onSave:(route:RouteRecord)=>Promise<void>}) {
  const [draft,setDraft]=useState<RouteRecord>(route??{id:'new-route',from:'Peshawar',to:'',distance:'',duration:'',fare:0,boarding:'Madina Terminal, Peshawar',status:'Active',destinations:[],services:[]});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const update=<K extends keyof RouteRecord>(key:K,value:RouteRecord[K])=>setDraft(current=>({...current,[key]:value}));
  const updateService=(index:number,changes:Partial<RouteService>)=>update('services',(draft.services||[]).map((item,i)=>i===index?{...item,...changes}:item));
  const stops=routeDestinations(draft);
  const layouts=fleet.filter(b=>!b.deleted&&b.isTemplate);
  return <div className="form-modal-overlay" role="dialog" aria-modal="true" aria-label={route?'Edit route':'Add route'}><form className="form-modal route-config-modal" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await onSave({...draft,id:route?draft.id:`route-${Date.now()}`});}catch(e){setError(e instanceof Error?e.message:'Could not save route.');}finally{setBusy(false);}}}>
    <header><div><h2>{route?'Edit route & services':'Add route'}</h2><p>Destinations, fares, departure choices and commissions.</p></div><button type="button" aria-label="Close" onClick={onClose}><X size={19}/></button></header>
    <div className="modal-form-grid">
      <label><span>Leaving from *</span><input required maxLength={120} value={draft.from} onChange={e=>update('from',e.target.value)}/></label><label><span>Route name / endpoint *</span><input required maxLength={120} value={draft.to} onChange={e=>update('to',e.target.value)}/></label>
      <label><span>Distance</span><input value={draft.distance} onChange={e=>update('distance',e.target.value)}/></label><label><span>Travel time</span><input value={draft.duration} onChange={e=>update('duration',e.target.value)}/></label>
      <MoneyField label="Default fare" value={draft.fare} onChange={v=>update('fare',v)}/><label><span>Status</span><select value={draft.status} onChange={e=>update('status',e.target.value as RouteRecord['status'])}><option>Active</option><option>Paused</option></select></label>
      <label className="span-2"><span>Boarding terminal *</span><input required value={draft.boarding} onChange={e=>update('boarding',e.target.value)}/></label>
      <div className="span-2 management-repeater"><strong>Destinations</strong>{(draft.destinations||[]).map((stop,index)=><div className="class-row" key={index}><label><span>Destination</span><input required maxLength={120} value={stop.name} onChange={e=>update('destinations',draft.destinations!.map((s,i)=>i===index?{...s,name:e.target.value}:s))}/></label><MoneyField label="Default fare" value={stop.fare} onChange={fare=>update('destinations',draft.destinations!.map((s,i)=>i===index?{...s,fare}:s))}/><button type="button" aria-label="Remove destination" onClick={()=>update('destinations',draft.destinations!.filter((_,i)=>i!==index))}><X size={16}/></button></div>)}<button type="button" className="text-action" onClick={()=>update('destinations',[...(draft.destinations||[]),{name:'',fare:draft.fare}])}>+ Add destination</button><small>A single destination stays hidden on the ticket page.</small></div>
      <div className="span-2 management-repeater"><strong>Bus services & fares</strong>{(draft.services||[]).map((service,index)=>{const bus=layouts.find(b=>b.id===service.busId);const classes=bus?.seatClasses?.length?[...new Set(bus.seatClasses.map(g=>g.name).concat(bus.seatClasses.flatMap(g=>g.seats).length<bus.seats?['Standard']:[]))]:['Standard'];return <fieldset className="route-service" key={index}><div className="class-row"><label><span>Bus name</span><select required value={service.busId} onChange={e=>updateService(index,{busId:e.target.value})}><option value="">Choose bus</option>{layouts.map(b=><option key={b.id} value={b.id}>{b.model}</option>)}</select></label><label><span>Fixed commission % (blank = bus setting)</span><input type="number" min="0" max="100" step="0.01" value={service.commissionRate??''} onChange={e=>updateService(index,{commissionRate:e.target.value===''?undefined:Number(e.target.value)})}/></label><button type="button" aria-label="Remove service" onClick={()=>update('services',draft.services!.filter((_,i)=>i!==index))}><X size={16}/></button></div><label><span>Departure choices · HH:MM, comma separated</span><input defaultValue={service.times.join(', ')} placeholder="09:00, 10:00, 12:00" onBlur={e=>updateService(index,{times:e.target.value.split(',').map(t=>t.trim()).filter(Boolean)})}/></label><div className="service-fares">{stops.map(stop=>classes.map(name=><label key={`${stop.name}-${name}`}><span>{stop.name} · {name}</span><input aria-label={`${stop.name} ${name} fare`} type="number" min="0" step="0.01" value={service.fares[stop.name]?.[name]??stop.fare} onChange={e=>updateService(index,{fares:{...service.fares,[stop.name]:{...service.fares[stop.name],[name]:Number(e.target.value)}}})}/></label>))}</div></fieldset>;})}<button type="button" className="text-action" onClick={()=>update('services',[...(draft.services||[]),{busId:layouts.find(b=>!draft.services?.some(s=>s.busId===b.id))?.id||'',times:[],fares:{}}])}>+ Add bus service</button></div>
    </div>{error&&<p className="form-error" role="alert">{error}</p>}<footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy?'Saving…':'Save route'}</button></footer>
  </form></div>;
}

function RoutesView({
  fleet,
  routes,
  onSave,
  onDelete,
}: {
  routes: RouteRecord[];
  fleet: BusRecord[];
  onSave: (route: RouteRecord) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<RouteRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<RouteRecord | null>(null);
  const [filter, setFilter] = useState<"Active routes" | "Paused">(
    "Active routes",
  );
  const [search, setSearch] = useState("");
  const visibleRoutes = routes.filter(
    (route) => !route.deleted &&
      (filter === "Active routes"
        ? route.status === "Active"
        : route.status === "Paused") &&
      `${route.from} ${route.to} ${route.boarding} ${shortRouteCode(route.id)} ${route.id}`
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
                    <small title={r.id}>Route code · {shortRouteCode(r.id)}</small>
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
          fleet={fleet}
          route={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={async(route) => {
            await onSave(route);
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

function FinanceProtected({ onOpenSettings, children }: {
  onOpenSettings: () => void;
  children: React.ReactNode;
}) {
  const [pin, setPin] = useState("");
  const [pinConfigured, setPinConfigured] = useState<boolean | null>(null);
  const [unlockedUntil, setUnlockedUntil] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const accessVersion = useRef(0);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const version = accessVersion.current;
      try {
        const status = await api.financeStatus();
        if (!active || version !== accessVersion.current) return;
        setPinConfigured(status.pinConfigured);
        setUnlockedUntil(status.unlocked ? Date.now() + status.expiresIn * 1000 : 0);
      } catch (error) {
        if (active && version === accessVersion.current) {
          setUnlockedUntil(0);
          setError(error instanceof Error ? error.message : "Finance status is unavailable.");
        }
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    if (!unlockedUntil) return;
    const expiry = window.setTimeout(() => setUnlockedUntil(0), Math.max(0, unlockedUntil - Date.now()));
    return () => window.clearTimeout(expiry);
  }, [unlockedUntil]);

  if (unlockedUntil > 0) return <>{children}</>;
  return (
    <div className="finance-lock-page">
      <div className="finance-blur-preview" aria-hidden="true"><div /><div /><div /><div /></div>
      <form className="finance-unlock-card" onSubmit={async event => {
        event.preventDefault();
        if (!pinConfigured || submitting) return;
        accessVersion.current++;
        setSubmitting(true);
        setError("");
        try {
          const result = await api.unlockFinance(pin);
          accessVersion.current++;
          setUnlockedUntil(Date.now() + result.expiresIn * 1000);
          setPin("");
        } catch (error) {
          if (error instanceof ApiError && error.code === "finance_pin_not_set") setPinConfigured(false);
          setError(error instanceof Error ? error.message : "Finance could not be unlocked.");
        } finally {
          setSubmitting(false);
        }
      }}>
        <span className="finance-lock-icon"><LockKeyhole size={25} /></span>
        <h1>Finance is locked</h1>
        {pinConfigured === false ? (
          <>
            <p>Set a finance PIN in Settings to open Finance and Expenses.</p>
            <button className="primary-button" type="button" onClick={onOpenSettings}>Open settings</button>
          </>
        ) : (
          <>
            <p>Enter your finance PIN to unlock Finance and Expenses for 15 minutes.</p>
            <label>
              <span>Finance PIN</span>
              <input type="password" inputMode="numeric" pattern="[0-9]{6,10}" maxLength={10}
                value={pin} onChange={event => setPin(event.target.value)} autoComplete="off"
                disabled={!pinConfigured || submitting} required />
            </label>
            <button className="primary-button" type="submit" disabled={!pinConfigured || submitting}>
              <KeyRound size={16} /> {submitting ? "Unlocking…" : pinConfigured === null && !error ? "Checking…" : "Unlock finance"}
            </button>
          </>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
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
  const [range,setRange]=useState<DateRange>({from:"",to:""});
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
  const visibleExpenses=expenses.filter(e=>inDateRange(e.date,range));
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
          <label><span>Paid by</span><select value={draft.paymentMethod} onChange={(e) => updateDraft("paymentMethod", e.target.value)}><option>Cash</option><option>Bank transfer</option></select></label>
          <label><span>Reference</span><input value={draft.reference} onChange={(e) => updateDraft("reference", e.target.value)} placeholder={draft.paymentMethod === "Cash" ? "Optional" : "Required"} /></label>
          <label><span>Notes</span><input value={draft.notes} onChange={(e) => updateDraft("notes", e.target.value)} placeholder="Optional" /></label>
          <button className="primary-button" type="submit"><Plus size={16} /> Save expense</button>
        </form>
      </section>
      <section className="surface data-surface">
        <SurfaceHeader title="Expense history" text={`${visibleExpenses.length} records · ${money(visibleExpenses.reduce((sum,e)=>sum+e.amount,0))}`} /><DateRangeFilter value={range} onChange={setRange} label="Expense dates"/>
        {loading ? <p className="table-loading">Loading expenses…</p> : (
          <div className="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Method</th><th>Amount</th><th>Recorded by</th></tr></thead><tbody>
            {visibleExpenses.length ? visibleExpenses.map((expense) => <tr key={expense.id}><td>{expense.date}</td><td>{expense.category}</td><td><strong>{presentationText(expense.description)}</strong><small title={expense.reference || undefined}>{expense.reference ? shortPaymentReference(expense.reference) : presentationText(expense.notes || "—")}</small></td><td>{expense.paymentMethod}</td><td><strong>{money(expense.amount)}</strong></td><td>{presentationText(expense.createdBy)}</td></tr>) : <tr><td colSpan={6}><EmptyState title="No expenses recorded" text="Use the form above to add the first expense." /></td></tr>}
          </tbody></table></div>
        )}
      </section>
    </div>
  );
}

function DonutChart({title,items,formatValue=String}:{title:string;items:{label:string;value:number;color:string}[];formatValue?:(value:number)=>string}) {
  const total=items.reduce((sum,item)=>sum+item.value,0);
  return <section className="surface donut-panel"><SurfaceHeader title={title} text={total?"Selected travel dates":"No activity in this date range"}/><div className="donut-body"><svg viewBox="0 0 160 160" role="img" aria-label={`${title}: ${items.map(i=>`${i.label} ${formatValue(i.value)}`).join(", ")}`}><circle cx="80" cy="80" r="60" fill="none" stroke="#edf1f4" strokeWidth="22"/>{items.map((item,index)=>{const share=total?item.value/total*100:0,start=total?items.slice(0,index).reduce((sum,i)=>sum+i.value,0)/total*100:0;return <circle key={item.label} cx="80" cy="80" r="60" fill="none" stroke={item.color} strokeWidth="22" pathLength="100" strokeDasharray={`${share} ${100-share}`} strokeDashoffset={-start} transform="rotate(-90 80 80)"/>;})}<text x="80" y="78" textAnchor="middle" className="donut-total">{formatValue(total)}</text><text x="80" y="96" textAnchor="middle" className="donut-caption">TOTAL</text></svg><ul>{items.map(item=><li key={item.label}><i style={{background:item.color}}/><span>{item.label}</span><strong>{formatValue(item.value)}</strong></li>)}</ul></div></section>;
}

function FinanceView({ bookings }: { bookings: Booking[] }) {
  const [range,setRange]=useState<DateRange>({from:"",to:""});
  const [expenses,setExpenses] = useState<ExpenseRecord[]>([]);
  const [expenseError,setExpenseError] = useState("");
  const [expensesLoaded,setExpensesLoaded] = useState(false);
  useEffect(()=>{let active=true;const refresh=()=>api.listExpenses<ExpenseRecord>().then(result=>{if(active){setExpenses(result.expenses);setExpensesLoaded(true);setExpenseError("");}}).catch(e=>{if(active)setExpenseError(e instanceof Error?e.message:"Could not load expenses.");});void refresh();const timer=window.setInterval(()=>void refresh(),30000);return()=>{active=false;window.clearInterval(timer);};},[]);
  const visibleExpenses=expenses.filter(e=>inDateRange(e.date,range));
  const expenseTotal=visibleExpenses.reduce((sum,e)=>sum+e.amount,0);
  const [period, setPeriod] = useState<"7 days" | "30 days">("7 days");
  const settled = bookings.filter((booking) => booking.paid > 0 && inDateRange(booking.date,range));
  const refunds = settled.flatMap((booking) =>
    (booking.refunds ?? []).map((refund) => ({ booking, refund })),
  );
  const methods: PaymentMethod[] = ["Cash", "1Bill", "Bank transfer"];
  if (settled.some(booking => booking.paymentMethod === "Card") || refunds.some(({ refund }) => refund.method === "Card")) {
    methods.push("Card");
  }
  const methodColors: Record<PaymentMethod, string> = { Cash: "#1454a0", "1Bill": "#e9b23f", "Bank transfer": "#23a18b", Card: "#a768ba" };
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
      const date = new Date(`${range.to||today}T12:00:00`);
      date.setDate(date.getDate() - endOffset - dayIndex);
      return dateInPakistan(date);
    });
    const collected = settled
      .filter((booking) => dates.includes(booking.date))
      .reduce((sum, booking) => sum + booking.paid, 0);
    const returned = refunds
      .filter((item) => dates.includes(item.booking.date))
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
        text="Sales and their refunds by travel date; operating costs by expense date."
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
                  ...visibleExpenses.map(e=>["Expense","",e.description,e.paymentMethod,e.reference,-e.amount,e.category,e.date,"",e.createdBy]),
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
      <DateRangeFilter value={range} onChange={setRange}/>
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
      <div className="finance-visuals">
        <DonutChart title="Sales by payment method" formatValue={money} items={methods.map(method => ({
          label: method,
          color: methodColors[method],
          value: settled.filter(booking => booking.paymentMethod === method).reduce((sum, booking) => sum + booking.paid, 0),
        }))} />
        <DonutChart title="Ticket status" items={[{label:"Booked",status:"Confirmed",color:"#1454a0"},{label:"Reserved",status:"Reserved",color:"#8cb9ed"},{label:"Refunded",status:"Refunded",color:"#dd8264"},{label:"Cancelled",status:"Cancelled",color:"#9aa8b5"}].map(item=>({...item,value:bookings.filter(b=>inDateRange(b.date,range)&&b.bookingStatus===item.status).reduce((sum,b)=>sum+b.seats.length,0)}))}/>
      </div>
      <section className="surface route-revenue"><SurfaceHeader title="Net sales by route" text="Collected fares less recorded refunds"/><div>{[...new Set(settled.map(b=>b.route))].map(route=>{const value=settled.filter(b=>b.route===route).reduce((sum,b)=>sum+netCollected(b),0);return <div className="route-revenue-row" key={route}><span>{route}</span><i><em style={{width:`${total?value/total*100:0}%`}}/></i><strong>{money(value)}</strong></div>;})}{!settled.length&&<p>No sales in this date range.</p>}</div></section>
      <div className="finance-grid">
        <section className="surface finance-chart">
          <SurfaceHeader
            title={
              period === "7 days" ? "Seven-day collections" : "Thirty-day trend"
            }
            text={`Travel-date collections after refunds · ending ${range.to||today}`}
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
          {methods.map(
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
                        <small title={refund.reference}>{shortPaymentReference(refund.reference)}</small>
                      </td>
                      <td>
                        <strong>{refund.reason}</strong>
                        <small>{presentationText(refund.notes || "No additional notes")}</small>
                      </td>
                      <td>
                        <strong>{formatPrintTime(refund.processedAt)}</strong>
                        <small>{presentationText(refund.processedBy)}</small>
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
                value={presentationText(draft.license)}
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
  onStaffSaved,
  onStaffRemoved,
  showToast,
}: {
  user: StaffUser;
  onUserChange: (user: StaffUser) => void;
  paymentMode: string;
  staffUsers: StaffUser[];
  onStaffSaved: (user: StaffUser) => void;
  onStaffRemoved: (id: number) => void;
  showToast: (message: string) => void;
}) {
  const [autoPrint, setAutoPrint] = useState(autoPrintEnabled);
  const [ticketPaper, setTicketPaper] = useState(getTicketPaper);
  const [connectingPrinter, setConnectingPrinter] = useState(false);
  const [sampleReceipt, setSampleReceipt] = useState(false),
    [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [savingPassword, setSavingPassword] = useState(false);
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
              <input value={paymentMode === "disabled" ? "Unavailable" : "Checkout available"} readOnly />
            </label>
            <label>
              <span>Online booking</span>
              <input value={paymentMode === "disabled" ? "Unavailable" : "Enabled"} readOnly />
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
              <strong>Payment settings</strong>
              <small>Payment configuration is managed on the server.</small>
            </span>
          </div>
        </section>
        {user.isOwner && !user.forcePasswordChange && (
          <>
            <AccountAccessSettings staffUsers={staffUsers} onSaved={onStaffSaved} onRemoved={onStaffRemoved} showToast={showToast} />
            <TerminalServerSettings showToast={showToast} />
            <ApplicationUpdateSettings showToast={showToast} />
            <FinancePinSettings showToast={showToast} />
          </>
        )}
        <BookingPolicySettings editable={Boolean(user.isOwner)} showToast={showToast}/>
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
          <label className="auto-print-setting">
            <input
              type="checkbox"
              checked={autoPrint}
              onChange={event => {
                const enabled = event.target.checked;
                try {
                  localStorage.setItem(autoPrintPreference, String(enabled));
                  setAutoPrint(enabled);
                } catch {
                  showToast("This browser could not save the print setting.");
                }
              }}
            />
            <span>
              <strong>Auto-print after collecting payment</strong>
              <small>Send the receipt and boarding pass to print as soon as payment is collected.</small>
            </span>
          </label>
          <div className="settings-fields">
            <label className="span-2">
              <span>Ticket paper</span>
              <select value={ticketPaper} onChange={event => {
                const paper = event.target.value as TicketPaper;
                try {
                  localStorage.setItem(ticketPaperPreference, paper);
                  setTicketPaper(paper);
                } catch {
                  showToast("This browser could not save the paper setting.");
                }
              }}>
                <option value="thermal">80 mm thermal portrait · separate jobs</option>
                <option value="a4">A4 portrait</option>
                <option value="tm-t88iv">Epson TM-T88IV · 80 mm USB</option>
              </select>
            </label>
          </div>
          <div className="view-actions">
            {ticketPaper === "tm-t88iv" && <button className="secondary-button" type="button" disabled={connectingPrinter} onClick={async () => {
              setConnectingPrinter(true);
              try {
                await connectEpsonTicketPrinter();
                showToast("Epson TM-T88IV connected.");
              } catch (error) {
                showToast(error instanceof Error ? error.message : "Could not connect the TM-T88IV.");
              } finally {
                setConnectingPrinter(false);
              }
            }}>{connectingPrinter ? "Connecting…" : "Connect USB printer"}</button>}
            <button className="secondary-button" type="button" onClick={() => setSampleReceipt(true)}>
              <Printer size={15} /> Print sample
            </button>
            <a className="secondary-button" href={`${appBase}/Madina-Express-Counter.cmd`} download>
              Download silent ticket launcher
            </a>
          </div>
          <p className="receipt-print-help">
            On Windows, set the 80 mm printer as the default and open the downloaded launcher to print tickets silently in Chrome. Use Firefox for the A4 CNIC and voucher print dialog.
          </p>
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
          paper={ticketPaper}
          onClose={() => setSampleReceipt(false)}
        />
      )}
    </div>
  );
}

function TerminalConnectionBanner() {
  const [connection, setConnection] = useState<Awaited<ReturnType<typeof api.terminalConnection>>>();
  useEffect(() => {
    let active = true;
    const check = () => api.terminalConnection().then(result => { if (active) setConnection(result); }).catch(() => undefined);
    void check();
    const timer = window.setInterval(check, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  if (connection?.readOnly) return <div className="terminal-connection-notice" role="status"><ShieldCheck size={16} />Main PC offline or being set up · viewing the last synced cloud data. Changes remain available on the local terminal network.</div>;
  if (!connection?.local || (connection.connected && connection.replicated)) return null;
  return <div className="terminal-connection-notice" role="status"><ShieldCheck size={16} />
    {connection.connected ? "Working locally · cloud backup is catching up." : "Working locally · internet connection unavailable. Seats and payments continue on this terminal network."}
  </div>;
}

function TerminalServerSettings({ showToast }: { showToast: (message: string) => void }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.terminalStatus>>>();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<Awaited<ReturnType<typeof api.terminalAccess>>>();
  const refresh = useCallback(async () => {
    try {
      const [state, terminals] = await Promise.all([api.terminalStatus(), api.terminalAccess()]);
      setStatus(state); setDevices(terminals);
    } catch (error) { showToast(error instanceof Error ? error.message : "Could not check the terminal server."); }
  }, [showToast]);
  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [refresh]);
  const download = async (slot?: number) => {
    if (busy) return;
    if (!password) { showToast("Enter your current administrator password to create a setup file."); return; }
    setBusy(true);
    try {
      if (slot) await api.terminalPcSetup(slot, password);
      else await api.mainPcSetup(password);
      setPassword("");
      showToast(slot ? `PC ${slot} setup downloaded. Use it within 30 minutes.` : "Main PC setup downloaded. Extract the ZIP on the main Windows PC.");
      await refresh();
    } catch (error) { showToast(error instanceof Error ? error.message : "Setup file could not be created."); }
    finally { setBusy(false); }
  };
  const local = status?.mode === "terminal";
  return <section className="surface settings-card">
    <SettingsTitle icon={<ShieldCheck size={19} />} title="Main PC & offline access"
      text={local ? "All counters use this local server, including during internet outages." : "Install one local server on the main Windows PC, then enroll the three counter profiles."} />
    {status && <div className="policy-box"><RefreshCw size={17} /><span>
      <strong>{local ? status.connected ? "Cloud connected" : "Working locally · cloud disconnected" : status.phase === "preparing" ? "Main PC setup in progress" : "Cloud server active"}</strong>
      <small>{local ? `${status.localOrigin} · ${status.replicated ? "Cloud copy syncing" : "Cloud copy awaiting connection"}${status.secondsBehind != null ? ` · ${status.secondsBehind}s behind` : ""}` : "Downloading setup keeps the cloud running. Starting the installer transfers booking authority to the main PC."}</small>
    </span></div>}
    <div className="settings-fields"><label className="span-2"><span>Current administrator password</span>
      <input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
    </label></div>
    <div className="view-actions">
      {local ? [1, 2, 3].map(slot => <button className="secondary-button" key={slot} disabled={busy} onClick={() => void download(slot)}>PC {slot} setup</button>) :
        <button className="primary-button" disabled={busy || !status || status.mode !== "cloud"} onClick={() => void download()}>{busy ? "Preparing setup…" : "Download main PC installer"}</button>}
      <button className="secondary-button" disabled={busy} onClick={() => void refresh()}>Refresh status</button>
      {!local && status?.phase === "preparing" && <button className="secondary-button" disabled={busy || !password} onClick={async () => {
        setBusy(true);
        try { await api.cancelTerminalSetup(password); setPassword(""); await refresh(); showToast("Unfinished setup cancelled. Download a fresh main PC installer."); }
        catch (error) { showToast(error instanceof Error ? error.message : "Could not cancel setup."); }
        finally { setBusy(false); }
      }}>Cancel unfinished setup</button>}
    </div>
    {local && <ul className="terminal-slots">{devices?.terminals.map(device => <li key={device.slot}>
      PC {device.slot} · <strong>{device.enrolled ? "Enrolled" : "Pending setup"}</strong>{device.enrolled && <button className="text-action" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await api.revokeTerminal(device.slot); await refresh(); showToast(`PC ${device.slot} access revoked.`); }
        catch (error) { showToast(error instanceof Error ? error.message : "Could not revoke this PC."); }
        finally { setBusy(false); }
      }}>Revoke access</button>}
    </li>)}</ul>}
    <details><summary>Installation steps</summary><ol>
      <li>Use a 64-bit Windows 10/11 main PC with PowerShell 5.1 and a fixed private IPv4 address. Windows 7 cannot run the installer. Connect the PCs to the same trusted router.</li>
      <li>Download the main installer here, extract the ZIP, and run Install-Main-PC.cmd on the main PC. Enter its local IPv4 address when asked and approve Windows elevation.</li>
      <li>Open the local address shown by setup, sign in as admin with your authenticator, and return to Settings.</li>
      <li>Create a separate PC 1, PC 2 and PC 3 setup file. Run each one in the Windows profile used at that counter, including PC 1 on the main PC. The saved main IP is included.</li>
      <li>Use the new Madina Express Counter desktop shortcut. Keep the main PC awake. Its server starts after reboot.</li>
      <li>When moving the same main PC to another LAN, run Change-Main-PC-Network.cmd from the retained main installer folder. On enrolled child PCs run Change-Terminal-PC-Address.cmd with the new main IP. Data and PC enrollment are preserved.</li>
    </ol><p>Child setup files expire after 30 minutes and require a TPM. Staff need both their account password and an enrolled PC. The main admin can sign in remotely with the authenticator even when the main PC is offline; the cloud then shows the last synced data. Changes resume when the main PC reconnects.</p>
    <p>During internet outages, the counters continue locally. Public reservations pause and the cloud catches up after reconnection. The main PC stores daily backups for 30 days.</p></details>
  </section>;
}

function FinancePinSettings({ showToast }: { showToast: (message: string) => void }) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <section className="surface settings-card">
      <SettingsTitle icon={<LockKeyhole size={19} />} title="Finance PIN"
        text="Set or update the 6–10 digit code for Finance and Expenses." />
      <form className="settings-fields" onSubmit={async event => {
        event.preventDefault();
        if (saving) return;
        if (pin !== confirmPin) { showToast("The finance PINs do not match."); return; }
        setSaving(true);
        try {
          await api.setFinancePin(pin, password);
          setPin("");
          setConfirmPin("");
          setPassword("");
          showToast("Finance PIN saved. Finance access has been locked again.");
        } catch (error) {
          showToast(error instanceof Error ? error.message : "The finance PIN could not be saved.");
        } finally {
          setSaving(false);
        }
      }}>
        <label className="span-2">
          <span>Current administrator password</span>
          <input type="password" autoComplete="current-password" value={password} required
            onChange={event => setPassword(event.target.value)} />
        </label>
        <label>
          <span>New finance PIN</span>
          <input type="password" inputMode="numeric" pattern="[0-9]{6,10}" maxLength={10} autoComplete="off"
            value={pin} onChange={event => setPin(event.target.value)} required />
        </label>
        <label>
          <span>Confirm finance PIN</span>
          <input type="password" inputMode="numeric" pattern="[0-9]{6,10}" maxLength={10} autoComplete="off"
            value={confirmPin} onChange={event => setConfirmPin(event.target.value)} required />
        </label>
        <button className="primary-button span-2" type="submit" disabled={saving}><KeyRound size={15} />
          {saving ? "Saving…" : "Save finance PIN"}
        </button>
      </form>
    </section>
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
                    {b.bookingStatus === "Reserved" ? "Unpaid reservation" : b.paymentMethod}
                    {b.paymentReference && <span title={b.paymentReference}> · {shortPaymentReference(b.paymentReference)}</span>}
                  </small>
                </td>
                <td>
                  <strong>{money(b.paid || b.total)}</strong>
                  <small>
                    {refundedTotal(b)
                      ? `${money(refundedTotal(b))} refunded · ${(b.refunds ?? []).at(-1)?.reason}${(b.refunds ?? []).at(-1)?.notes ? ` · ${presentationText((b.refunds ?? []).at(-1)?.notes??"")}` : ""}`
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
  seatClasses,
  seats,
  service,
  selectedSeats,
  occupied,
  reserved = new Set<number>(),
  female,
  online,
  onOccupied,
  onEnter,
  onSelect,
  large = false,
  locked = false,
}: {
  seatClasses?:SeatClass[];
  seats: number;
  service: string;
  selectedSeats: number[];
  occupied: Set<number>;
  reserved?: Set<number>;
  female?: Set<number>;
  online?: Set<number>;
  onOccupied?: (seat:number)=>void;
  onEnter?: (seat: number) => boolean;
  onSelect: (seat: number) => void;
  large?: boolean;
  locked?: boolean;
}) {
  const sleeper = isSleeper(service);
  const renderSeat = (seat: number | null) => seat === null
    ? <span className="seat-space" aria-hidden="true" />
    : <SeatButton className={seatClasses?.find(g=>g.seats.includes(seat))?.name} locked={locked} seat={seat} label={seatLabel(seat, service)}
        selected={selectedSeats.includes(seat)} occupied={occupied.has(seat)}
        female={Boolean(female?.has(seat))} online={Boolean(online?.has(seat))} reserved={reserved.has(seat)} interactive={Boolean(onOccupied)} onEnter={onEnter} onSelect={occupied.has(seat) && onOccupied ? onOccupied : onSelect} />;
  return (
    <div className={`seat-map-wrap reference-seat-map ${sleeper ? "sleeper-map" : "coach-map"} ${large ? "large" : ""}`}>
      <div className="legend">
        <span><i className="available" />Available</span>
        <span><i className="selected" />Selected</span>
        <span><i className="reserved" />Reserved</span><span><i className="booked" />Booked</span>
        {female&&<span><i className="female"/>Female</span>}{online&&<span><i className="online"/>Online · W</span>}
      </div>
      {seatClasses?.length? <div className="seat-class-key">{seatClasses.map(group=><span key={group.name}>{group.name}: {group.seats[0]}–{group.seats.at(-1)}</span>)}</div>:null}
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
  className,
  seat,
  locked,
  label,
  selected,
  occupied,
  reserved,
  female,
  online,
  interactive,
  onEnter,
  onSelect,
}: {
  className?:string;
  seat: number;
  locked:boolean;
  label: string;
  selected: boolean;
  occupied: boolean;
  reserved: boolean;
  female: boolean;
  online: boolean;
  interactive: boolean;
  onEnter?: (seat: number) => boolean;
  onSelect: (seat: number) => void;
}) {
  const status = reserved ? "reserved" : occupied ? "booked" : selected ? "selected" : "available";
  return (
    <button
      type="button"
      disabled={(occupied && !interactive)||(!occupied&&locked)}
      className={`seat seat--${status}${female?" seat--female":""}${online?" seat--online":""}`}
      title={className?`${className} · Seat ${label}`:undefined}
      aria-label={`Seat ${label}, ${status}${className?", "+className:""}${female?", female":""}${online?", online":""}`}
      aria-pressed={selected && !occupied}
      onKeyDown={event => {
        if (!onEnter || event.key !== "Enter" || event.nativeEvent.isComposing ||
          event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.repeat || onEnter(seat)) event.preventDefault();
      }}
      onClick={() => onSelect(seat)}
    >
      <b>{label}</b>{(online||reserved)&&<small className="seat-marker" aria-hidden="true">{online?"W":""}{reserved?"R":""}</small>}
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

function AutomaticTicketPrint({ request, onFinish }: {
  request: AutomaticPrintRequest;
  onFinish: (bookingId: string, error?: string) => void;
}) {
  const source = useRef<HTMLDivElement>(null);
  const [printedAt] = useState(() => new Date());
  useEffect(() => {
    if (!source.current) return;
    const run = new AbortController();
    void printTicketBatch(source.current, request.paper, run.signal).then(
      () => { if (!run.signal.aborted) onFinish(request.bookingId); },
      (error: unknown) => {
        if (!run.signal.aborted) onFinish(request.bookingId, `Ticket issued. ${ticketPrintError(request.paper, error)}`);
      },
    );
    return () => run.abort();
  }, [request, onFinish]);
  return <div ref={source} hidden><TicketPrintPairs entries={request.entries} printedAt={printedAt} /></div>;
}

function ticketPrintError(paper: TicketPaper, error: unknown) {
  if (paper === "tm-t88iv" && error instanceof Error) return error.message;
  return "Printing stopped. Check your print settings and reprint the ticket.";
}

function ReceiptModal({ booking, batch = [], paper = "thermal", onClose }: {
  booking: Booking;
  batch?: Booking[];
  paper?: TicketPaper;
  onClose: () => void;
}) {
  const [printing,setPrinting]=useState(false);
  const [printedAt,setPrintedAt]=useState(()=>new Date());
  const [printError, setPrintError] = useState("");
  const printArea = useRef<HTMLDivElement>(null);
  const printRun = useRef<AbortController | null>(null);
  const print = useCallback(async () => {
    if (!printArea.current || printRun.current) return;
    const run = new AbortController();
    printRun.current = run;
    setPrinting(true);
    setPrintError("");
    try {
      flushSync(() => setPrintedAt(new Date()));
      if (printArea.current) await printTicketBatch(printArea.current, paper, run.signal);
    } catch (error) {
      if (!run.signal.aborted) setPrintError(ticketPrintError(paper, error));
    } finally {
      printRun.current = null;
      if (!run.signal.aborted) setPrinting(false);
    }
  }, [paper]);
  useEffect(() => () => printRun.current?.abort(), []);
  const entries=batch.length?batch:[booking];
  const hasBoardingPass = entries.some(entry => ticketPresentation(entry).canBoard);
  if(booking.bookingStatus==="Reserved")return <div className="receipt-overlay" role="dialog" aria-modal="true" aria-label="Reservation saved"><div className="receipt-modal reservation-confirmation"><h2>Seats reserved</h2><p>{booking.passenger} · Seat {seatList(booking.seats,booking.service)}</p><p>{booking.route} · {ticketDate(booking.date)} · {booking.time}</p><p>Pay at the counter to receive your ticket and boarding token.</p><button className="primary-button" onClick={onClose}>Done</button></div></div>;
  return <div className="receipt-overlay" role="dialog" aria-modal="true" aria-label={`Ticket ${booking.ticketNo}`}><div className="receipt-modal ticket-print-modal">
    <div className="receipt-toolbar"><div><strong>{entries.length>1?`${entries.length} separate tickets`:"Passenger ticket"}</strong><small>{paper === "tm-t88iv" ? "Epson TM-T88IV · cut after each slip" : paper === "a4" ? "A4 portrait · one page per slip" : "80 mm thermal portrait · one job per slip"}</small></div><button type="button" aria-label="Close ticket" onClick={onClose}><X size={18}/></button></div>
    <div ref={printArea} className="receipt thermal-ticket"><TicketPrintPairs entries={entries} printedAt={printedAt} /></div>
    {printError && <p className="form-error" role="alert">{printError}</p>}
    <div className="receipt-actions">
      <button type="button" className="secondary-button" onClick={onClose}>Close</button>
      <button type="button" className="primary-button" disabled={printing} onClick={() => void print()}>
        <Printer size={16}/>{printing ? "Printing…" : hasBoardingPass ? "Print receipt & boarding pass" : "Print refund record"}
      </button>
    </div>
  </div></div>;
}

function TicketPrintPairs({ entries, printedAt }: { entries: Booking[]; printedAt: Date }) {
  return entries.filter(b=>b.bookingStatus!=="Reserved").flatMap(b=>b.seats.map((seat,index)=>{
    // Legacy multi-seat records remain intact; reprints apportion totals in cents.
    const share=(amount:number)=>{const cents=Math.round(amount*100);return (Math.floor(cents/b.seats.length)+(index<cents%b.seats.length?1:0))/100;};
    return <div className="ticket-print-pair" key={`${b.id}-${seat}`}>
      <TicketSlips booking={{...b,seats:[seat],total:share(b.total),paid:share(b.paid),discount:share(b.discount),refunds:(b.refunds??[]).map(r=>({...r,amount:share(r.amount)}))}} printedAt={printedAt}/>
    </div>;
  }));
}

function TicketSlips({booking,printedAt}:{booking:Booking;printedAt:Date}) {
  const ticket=ticketPresentation(booking),seats=seatList(booking.seats,booking.service);
  return <>
    <article className="passenger-receipt" aria-label={`Passenger receipt seat ${seats}`}>
      <header className="thermal-heading"><div className="ticket-brand-mark">SDK</div><h2>MADINA EXPRESS</h2><p className="ticket-contact">0311-777-2299 / 0315-777-2299</p></header>
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
      <p className="ticket-booking-promo">Book online: <strong>MadinaExpress.pk</strong></p>
    </article>
    {ticket.canBoard && <article className="conductor-token" aria-label={`Conductor boarding token seat ${seats}`}>
      <header><strong>MADINA EXPRESS</strong><span>BOARDING TOKEN</span></header><div className="token-seats"><span>SEAT NO #</span><strong>{seats}</strong></div>
      <table className="token-table"><tbody><tr><th>Bus No.</th><th>Destination</th></tr><tr><td>{booking.bus}</td><td>{booking.destination}</td></tr><tr><th>Travel date</th><th>Departure</th></tr><tr><td>{ticketDate(booking.date)}</td><td className="token-time">{booking.time}</td></tr><tr><th>Ticket No.</th><th>Paid</th></tr><tr><td>{booking.ticketNo}</td><td>{money(netCollected(booking))}</td></tr></tbody></table>
      <p className="ticket-urdu" lang="ur" dir="rtl">یہ ٹوکن کنڈکٹر کے حوالے کریں۔</p>
    </article>}
  </>;
}

export default App;
