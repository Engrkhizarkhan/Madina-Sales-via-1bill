import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Armchair,
  BadgeCheck,
  BusFront,
  CalendarCheck,
  CalendarDays,
  Check,
  Clock3,
  CreditCard,
  FileText,
  Headphones,
  KeyRound,
  LockKeyhole,
  LogOut,
  MapPin,
  Navigation,
  PhoneCall,
  Printer,
  ReceiptText,
  RotateCcw,
  Route,
  Search,
  ShieldCheck,
  Star,
  Ticket,
  UserRound,
  UsersRound,
  WalletCards,
  X,
  XCircle,
} from 'lucide-react'
import './App.css'

type PaymentMethod = 'Cash' | 'Card' | 'Bank transfer' | '1Bill'
type PaymentStatus = 'Paid' | 'Partial' | 'Due'
type BookingStatus = 'Confirmed' | 'Cancelled'

type Booking = {
  id: string
  ticketNo: string
  passenger: string
  phone: string
  cnic: string
  gender: string
  route: string
  destination: string
  boardingPoint: string
  bus: string
  service: string
  seats: number[]
  fare: number
  discount: number
  total: number
  paid: number
  balance: number
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  bookingStatus: BookingStatus
  date: string
  time: string
  driver: string
  attendant: string
  createdAt: string
}

type PassengerForm = {
  passenger: string
  phone: string
  cnic: string
  idType: 'CNIC' | 'Passport'
  gender: 'Male' | 'Female'
  boardingPoint: string
  fare: number
  discount: number
  paid: number
  paymentMethod: PaymentMethod
  paymentReference: string
  notes: string
}

const today = new Date().toISOString().slice(0, 10)

const routes = [
  { id: 'psh-khi', label: 'Peshawar → Karachi', destination: 'Karachi', fare: 7000, boarding: 'Madina Terminal, Peshawar' },
  { id: 'psh-lhr', label: 'Peshawar → Lahore', destination: 'Lahore', fare: 4200, boarding: 'Madina Terminal, Peshawar' },
  { id: 'psh-isb', label: 'Peshawar → Islamabad', destination: 'Islamabad', fare: 1800, boarding: 'Madina Terminal, Peshawar' },
  { id: 'psh-mul', label: 'Peshawar → Multan', destination: 'Multan', fare: 4500, boarding: 'Madina Terminal, Peshawar' },
]

const buses = [
  { id: 'tae-388', registration: 'TAE-388', label: 'TAE-388 · Standard Plus', service: 'Standard Plus', seats: 49, booked: [2, 5, 8, 13, 17, 21, 29, 34, 42], reserved: [4, 18] },
  { id: 'taj-977', registration: 'TAJ-977', label: 'TAJ-977 · Sleeper Bus', service: 'Sleeper Bus', seats: 35, booked: [3, 6, 9, 12, 15, 19, 27], reserved: [7, 23] },
]

const initialBookings: Booking[] = [
  {
    id: 'sample-1', ticketNo: 'ME-260831-1426', passenger: 'Usman Ali', phone: '0301 8472210', cnic: '17301-4581266-3', gender: 'Male',
    route: 'Peshawar → Karachi', destination: 'Karachi', boardingPoint: 'Madina Terminal, Peshawar', bus: 'TAE-388', service: 'Standard Plus', seats: [11],
    fare: 7000, discount: 0, total: 7000, paid: 7000, balance: 0, paymentMethod: 'Cash', paymentStatus: 'Paid', bookingStatus: 'Confirmed',
    date: today, time: '16:00', driver: 'Muhammad Ameen', attendant: 'Ayesha Khan', createdAt: new Date().toISOString(),
  },
  {
    id: 'sample-2', ticketNo: 'ME-260831-1398', passenger: 'Sanaullah Khan', phone: '0333 5218490', cnic: '17301-1592366-5', gender: 'Male',
    route: 'Peshawar → Karachi', destination: 'Karachi', boardingPoint: 'Madina Terminal, Peshawar', bus: 'TAE-388', service: 'Standard Plus', seats: [14, 15],
    fare: 7000, discount: 500, total: 13500, paid: 10000, balance: 3500, paymentMethod: '1Bill', paymentStatus: 'Partial', bookingStatus: 'Confirmed',
    date: today, time: '16:00', driver: 'Muhammad Ameen', attendant: 'Ayesha Khan', createdAt: new Date().toISOString(),
  },
  {
    id: 'sample-3', ticketNo: 'ME-260831-1311', passenger: 'Maria Khan', phone: '0312 9908412', cnic: '17301-7421068-4', gender: 'Female',
    route: 'Peshawar → Lahore', destination: 'Lahore', boardingPoint: 'Madina Terminal, Peshawar', bus: 'TAJ-977', service: 'Sleeper Bus', seats: [22],
    fare: 4200, discount: 200, total: 4000, paid: 4000, balance: 0, paymentMethod: 'Card', paymentStatus: 'Paid', bookingStatus: 'Confirmed',
    date: today, time: '19:00', driver: 'Adeel Shah', attendant: 'Nazia Bibi', createdAt: new Date().toISOString(),
  },
]

const initialPassenger: PassengerForm = {
  passenger: '',
  phone: '',
  cnic: '',
  idType: 'CNIC',
  gender: 'Male',
  boardingPoint: routes[0].boarding,
  fare: routes[0].fare,
  discount: 0,
  paid: routes[0].fare,
  paymentMethod: 'Cash',
  paymentReference: '',
  notes: '',
}

const money = (value: number) => `PKR ${Math.max(0, value).toLocaleString('en-PK')}`

function getStoredBookings() {
  try {
    const stored = localStorage.getItem('madina-express-bookings')
    return stored ? (JSON.parse(stored) as Booking[]) : initialBookings
  } catch {
    return initialBookings
  }
}

function App() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = (nextPath: string) => {
    window.history.pushState({}, '', nextPath)
    setPath(nextPath)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (path.startsWith('/login')) return <LoginPage onNavigate={navigate} />
  if (path.startsWith('/manage')) {
    if (!import.meta.env.DEV && sessionStorage.getItem('madina-express-session') !== 'active') return <LoginPage onNavigate={navigate} />
    return <ManagementApp onLogout={() => { sessionStorage.removeItem('madina-express-session'); navigate('/login') }} />
  }
  return <PublicHome onNavigate={navigate} />
}

function PublicHome({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [from, setFrom] = useState('Peshawar')
  const [to, setTo] = useState('Karachi')
  const [date, setDate] = useState(today)
  const [searched, setSearched] = useState(false)

  return <div className="public-site">
    <header className="public-nav">
      <button className="public-brand" type="button" onClick={() => onNavigate('/')}><span className="brand-mark">ME</span><span><strong>Madina Express</strong><small>Travel with confidence</small></span></button>
      <nav aria-label="Main navigation"><a href="#routes">Routes</a><a href="#services">Services</a><a href="#contact">Contact</a></nav>
      <button className="staff-login-button" type="button" onClick={() => onNavigate('/login')}><KeyRound size={15} /> Staff login</button>
    </header>

    <main className="public-main">
      <section className="public-hero">
        <div className="hero-copy">
          <p className="public-kicker"><span /> Intercity travel across Pakistan</p>
          <h1>Your journey,<br /><em>made comfortable.</em></h1>
          <p>Reliable coaches, professional service and convenient departures connecting Peshawar with major cities across Pakistan.</p>
          <div className="hero-trust"><span><BadgeCheck size={17} /> Trusted service</span><span><ShieldCheck size={17} /> Safe journeys</span><span><Headphones size={17} /> Passenger support</span></div>
        </div>
        <div className="hero-visual"><img src="/og.png" alt="Madina Express modern intercity coach" /><div className="hero-rating"><span><Star size={14} fill="currentColor" /> 4.8</span><small>Passenger rating</small></div></div>
      </section>

      <section className="route-finder" id="routes">
        <div className="route-finder-heading"><span><Route size={18} /></span><div><h2>Find your next journey</h2><p>Check available departures and fares.</p></div></div>
        <form className="public-search" onSubmit={(event) => { event.preventDefault(); setSearched(true) }}>
          <label><span>Leaving from</span><select value={from} onChange={(event) => setFrom(event.target.value)}><option>Peshawar</option><option>Islamabad</option><option>Lahore</option><option>Multan</option></select></label>
          <div className="route-direction"><ArrowRight size={16} /></div>
          <label><span>Going to</span><select value={to} onChange={(event) => setTo(event.target.value)}><option>Karachi</option><option>Lahore</option><option>Islamabad</option><option>Multan</option></select></label>
          <label><span>Travel date</span><input type="date" min={today} value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <button type="submit" className="search-journey"><Search size={16} /> Search buses</button>
        </form>
      </section>

      {searched && <section className="public-results" aria-live="polite">
        <div className="results-heading"><div><p className="eyebrow">AVAILABLE DEPARTURES</p><h2>{from} to {to}</h2></div><span>{new Date(`${date}T00:00:00`).toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
        {[{ time: '09:00', service: 'Standard Plus', fare: 7000, seats: 18 }, { time: '16:00', service: 'Executive', fare: 7800, seats: 11 }, { time: '19:00', service: 'Sleeper Bus', fare: 8500, seats: 7 }].map((trip) => <article className="public-trip" key={trip.time}><div className="trip-time"><strong>{trip.time}</strong><small>Peshawar</small></div><div className="trip-line"><span /><BusFront size={19} /><span /></div><div className="trip-time arrival"><strong>{String((Number(trip.time.slice(0, 2)) + 14) % 24).padStart(2, '0')}:00</strong><small>{to}</small></div><div className="public-trip-service"><strong>{trip.service}</strong><small>{trip.seats} seats available</small></div><div className="public-trip-price"><small>Starting from</small><strong>{money(trip.fare)}</strong></div><button type="button" onClick={() => onNavigate('/login')}>Reserve at counter <ArrowRight size={14} /></button></article>)}
      </section>}

      <section className="public-benefits" id="services"><article><span><Navigation size={21} /></span><div><strong>Major city routes</strong><p>Convenient daily departures to Karachi, Lahore, Islamabad and Multan.</p></div></article><article><span><Armchair size={21} /></span><div><strong>Comfortable coaches</strong><p>Standard, executive and sleeper options for every journey.</p></div></article><article><span><PhoneCall size={21} /></span><div><strong>Here when you need us</strong><p>Contact our terminal team for booking and travel assistance.</p></div></article></section>
    </main>

    <footer className="public-footer" id="contact"><div className="public-brand"><span className="brand-mark">ME</span><span><strong>Madina Express</strong><small>Bus Service</small></span></div><p>Madina Terminal, Peshawar · 0311-777-2299</p><span>© 2026 Madina Express</span></footer>
  </div>
}

function LoginPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const signIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email || !password) return
    sessionStorage.setItem('madina-express-session', 'active')
    onNavigate('/manage')
  }

  return <div className="login-page">
    <button type="button" className="login-back" onClick={() => onNavigate('/')}><ArrowRight size={15} /> Back to website</button>
    <div className="login-shell">
      <section className="login-brand-panel"><div className="public-brand light"><span className="brand-mark">ME</span><span><strong>Madina Express</strong><small>Staff operations</small></span></div><div><p>SECURE STAFF ACCESS</p><h1>Manage every journey from one place.</h1><span>Bookings, reservations, payments and receipts for the Madina Express counter team.</span></div><small>Authorized personnel only</small></section>
      <form className="login-form" onSubmit={signIn}><div className="login-icon"><LockKeyhole size={20} /></div><h2>Welcome back</h2><p>Sign in to access the management system.</p><label><span>Email or username</span><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Enter your username" autoComplete="username" /></label><label><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" /></label><div className="login-row"><label><input type="checkbox" /> Remember this device</label><button type="button">Forgot password?</button></div><button className="login-submit" type="submit">Sign in to system <ArrowRight size={16} /></button><small>This frontend demo accepts any non-empty credentials.</small></form>
    </div>
  </div>
}

function ManagementApp({ onLogout }: { onLogout: () => void }) {
  const [routeId, setRouteId] = useState(routes[0].id)
  const [busId, setBusId] = useState(buses[0].id)
  const [travelDate, setTravelDate] = useState(today)
  const [departureTime, setDepartureTime] = useState('16:00')
  const [driver, setDriver] = useState('Muhammad Ameen')
  const [attendant, setAttendant] = useState('Ayesha Khan')
  const [passenger, setPassenger] = useState<PassengerForm>(initialPassenger)
  const [selectedSeats, setSelectedSeats] = useState<number[]>([7])
  const [bookings, setBookings] = useState<Booking[]>(getStoredBookings)
  const [search, setSearch] = useState('')
  const [receipt, setReceipt] = useState<Booking | null>(null)
  const [toast, setToast] = useState('')

  const route = routes.find((item) => item.id === routeId) ?? routes[0]
  const bus = buses.find((item) => item.id === busId) ?? buses[0]
  const total = Math.max(0, passenger.fare * selectedSeats.length - passenger.discount)
  const balance = Math.max(0, total - passenger.paid)
  const paymentStatus: PaymentStatus = passenger.paid >= total && total > 0 ? 'Paid' : passenger.paid > 0 ? 'Partial' : 'Due'

  const activeBookedSeats = useMemo(() => {
    const savedSeats = bookings
      .filter((item) => item.bus === bus.registration && item.date === travelDate && item.time === departureTime && item.bookingStatus === 'Confirmed')
      .flatMap((item) => item.seats)
    return new Set([...bus.booked, ...savedSeats])
  }, [bookings, bus, departureTime, travelDate])

  const currentTripBookings = bookings.filter((item) => item.bookingStatus === 'Confirmed' && item.date === travelDate && item.bus === bus.registration)
  const tripSales = currentTripBookings.reduce((sum, item) => sum + item.paid, 0)
  const tripBooked = new Set(currentTripBookings.flatMap((item) => item.seats)).size + bus.booked.length
  const visibleBookings = bookings.filter((item) => {
    const haystack = `${item.ticketNo} ${item.passenger} ${item.phone} ${item.cnic} ${item.route}`.toLowerCase()
    return haystack.includes(search.toLowerCase())
  })

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const persistBookings = (next: Booking[]) => {
    setBookings(next)
    localStorage.setItem('madina-express-bookings', JSON.stringify(next))
  }

  const updatePassenger = <K extends keyof PassengerForm>(key: K, value: PassengerForm[K]) => {
    setPassenger((current) => ({ ...current, [key]: value }))
  }

  const handleRouteChange = (newRouteId: string) => {
    const nextRoute = routes.find((item) => item.id === newRouteId) ?? routes[0]
    setRouteId(newRouteId)
    setPassenger((current) => ({ ...current, fare: nextRoute.fare, paid: nextRoute.fare, boardingPoint: nextRoute.boarding }))
  }

  const handleBusChange = (newBusId: string) => {
    setBusId(newBusId)
    setSelectedSeats([])
  }

  const toggleSeat = (seat: number) => {
    if (activeBookedSeats.has(seat) || bus.reserved.includes(seat)) return
    setSelectedSeats((current) => current.includes(seat) ? current.filter((item) => item !== seat) : [...current, seat].sort((a, b) => a - b))
  }

  const resetForm = () => {
    setPassenger({ ...initialPassenger, fare: route.fare, paid: route.fare, boardingPoint: route.boarding })
    setSelectedSeats([])
  }

  const saveBooking = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!passenger.passenger.trim() || !passenger.phone.trim()) {
      showToast('Enter the passenger name and mobile number.')
      return
    }
    if (!selectedSeats.length) {
      showToast('Select at least one available seat.')
      return
    }

    const stamp = Date.now()
    const newBooking: Booking = {
      id: String(stamp),
      ticketNo: `ME-${travelDate.slice(2).replaceAll('-', '')}-${String(stamp).slice(-4)}`,
      passenger: passenger.passenger.trim(),
      phone: passenger.phone.trim(),
      cnic: passenger.cnic.trim(),
      gender: passenger.gender,
      route: route.label,
      destination: route.destination,
      boardingPoint: passenger.boardingPoint,
      bus: bus.registration,
      service: bus.service,
      seats: selectedSeats,
      fare: passenger.fare,
      discount: passenger.discount,
      total,
      paid: passenger.paid,
      balance,
      paymentMethod: passenger.paymentMethod,
      paymentStatus,
      bookingStatus: 'Confirmed',
      date: travelDate,
      time: departureTime,
      driver,
      attendant,
      createdAt: new Date().toISOString(),
    }
    persistBookings([newBooking, ...bookings])
    setReceipt(newBooking)
    showToast(`Ticket ${newBooking.ticketNo} saved.`)
    resetForm()
  }

  const cancelBooking = (id: string) => {
    const next = bookings.map((item) => item.id === id ? { ...item, bookingStatus: 'Cancelled' as const } : item)
    persistBookings(next)
    showToast('Booking cancelled. The seat is available again.')
  }

  return (
    <div className="admin-shell">
      <div className="admin-content">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <div className="admin-brandbar"><span>ME</span><div><strong>Madina Express</strong><small>Management System</small></div></div>
            <nav className="admin-tabs" aria-label="Management navigation"><button type="button" className="active" onClick={() => document.getElementById('new-booking')?.scrollIntoView({ behavior: 'smooth' })}><Ticket size={15} /> New booking</button><button type="button" onClick={() => document.getElementById('reservations')?.scrollIntoView({ behavior: 'smooth' })}><CalendarCheck size={15} /> Reservations</button></nav>
          </div>
          <div className="admin-topbar-right"><span className="admin-shift"><i /> System ready</span><span className="admin-divider" /><div className="admin-user"><span className="avatar">SK</span><div><strong>Salman Khan</strong><small>Madina Terminal · Counter 01</small></div></div><button className="admin-signout" type="button" title="Sign out" aria-label="Sign out" onClick={onLogout}><LogOut size={15} /></button></div>
        </header>

        <main className="admin-main">
          <div className="admin-context"><div><strong>New booking</strong><span>Enter trip and passenger details, then select seats.</span></div><small>{new Date().toLocaleDateString('en-PK', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</small></div>

        <div className="booking-surface" id="new-booking">
        <section className="trip-panel admin-trip-panel">
          <div className="panel-heading">
            <div className="title-with-step"><div><h2>Trip selection</h2><p>Choose a route and bus, then enter the crew details.</p></div></div>
            <div className="trip-status"><BusFront size={15} /> {bus.seats - tripBooked} seats available</div>
          </div>
          <div className="trip-grid">
            <label className="wide-field"><span><MapPin size={13} /> Route</span><select value={routeId} onChange={(event) => handleRouteChange(event.target.value)}>{routes.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
            <label><span><BusFront size={13} /> Bus</span><select value={busId} onChange={(event) => handleBusChange(event.target.value)}>{buses.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
            <label><span><CalendarDays size={13} /> Travel date</span><input type="date" value={travelDate} onChange={(event) => setTravelDate(event.target.value)} /></label>
            <label><span><Clock3 size={13} /> Departure</span><input type="time" value={departureTime} onChange={(event) => setDepartureTime(event.target.value)} /></label>
            <label><span><UserRound size={13} /> Driver</span><input value={driver} onChange={(event) => setDriver(event.target.value)} placeholder="Driver name" /></label>
            <label><span><UsersRound size={13} /> Female attendant</span><input value={attendant} onChange={(event) => setAttendant(event.target.value)} placeholder="Attendant name" /></label>
          </div>
          <div className="trip-summary-bar">
            <span><small>Service</small><strong>{bus.service}</strong></span>
            <span><small>Vehicle</small><strong>{bus.registration}</strong></span>
            <span><small>Booked seats</small><strong>{tripBooked} / {bus.seats}</strong></span>
            <span><small>Trip collection</small><strong>{money(tripSales)}</strong></span>
          </div>
        </section>

        <form className="workspace-grid admin-booking-grid" onSubmit={saveBooking}>
          <section className="passenger-card">
            <div className="panel-heading">
              <div className="title-with-step"><div><h2>Passenger & payment</h2><p>Enter the customer details and collect the fare.</p></div></div>
              <ShieldCheck className="header-icon" size={20} />
            </div>

            <div className="section-label">PASSENGER DETAILS</div>
            <div className="form-grid">
              <label className="span-2"><span>Passenger name *</span><input value={passenger.passenger} onChange={(event) => updatePassenger('passenger', event.target.value)} placeholder="Enter full name" /></label>
              <label><span>Mobile number *</span><input value={passenger.phone} onChange={(event) => updatePassenger('phone', event.target.value)} placeholder="03XX XXXXXXX" inputMode="tel" /></label>
              <fieldset className="compact-choice"><legend>Gender</legend><div><button type="button" className={passenger.gender === 'Male' ? 'choice active' : 'choice'} onClick={() => updatePassenger('gender', 'Male')}>Male</button><button type="button" className={passenger.gender === 'Female' ? 'choice active' : 'choice'} onClick={() => updatePassenger('gender', 'Female')}>Female</button></div></fieldset>
              <fieldset className="compact-choice"><legend>ID type</legend><div><button type="button" className={passenger.idType === 'CNIC' ? 'choice active' : 'choice'} onClick={() => updatePassenger('idType', 'CNIC')}>CNIC</button><button type="button" className={passenger.idType === 'Passport' ? 'choice active' : 'choice'} onClick={() => updatePassenger('idType', 'Passport')}>Passport</button></div></fieldset>
              <label><span>{passenger.idType} number</span><input value={passenger.cnic} onChange={(event) => updatePassenger('cnic', event.target.value)} placeholder={passenger.idType === 'CNIC' ? 'XXXXX-XXXXXXX-X' : 'Enter passport no.'} /></label>
              <label className="span-2"><span>Boarding / pickup point</span><input value={passenger.boardingPoint} onChange={(event) => updatePassenger('boardingPoint', event.target.value)} /></label>
            </div>

            <div className="section-label payment-label">PAYMENT DETAILS</div>
            <div className="form-grid payment-grid">
              <label><span>Fare per seat</span><div className="money-input"><b>PKR</b><input type="number" min="0" value={passenger.fare} onChange={(event) => updatePassenger('fare', Number(event.target.value))} /></div></label>
              <label><span>Discount</span><div className="money-input"><b>PKR</b><input type="number" min="0" value={passenger.discount} onChange={(event) => updatePassenger('discount', Number(event.target.value))} /></div></label>
              <label><span>Amount received</span><div className="money-input"><b>PKR</b><input type="number" min="0" value={passenger.paid} onChange={(event) => updatePassenger('paid', Number(event.target.value))} /></div></label>
              <button type="button" className="full-payment" onClick={() => updatePassenger('paid', total)}><Check size={14} /> Mark fully paid</button>
            </div>
            <fieldset className="payment-methods"><legend>Payment method</legend><div>{(['Cash', 'Card', 'Bank transfer', '1Bill'] as PaymentMethod[]).map((method) => <button type="button" key={method} className={passenger.paymentMethod === method ? 'payment-method active' : 'payment-method'} onClick={() => updatePassenger('paymentMethod', method)}>{method === 'Cash' ? <WalletCards size={15} /> : <CreditCard size={15} />}{method}</button>)}</div></fieldset>
            {passenger.paymentMethod !== 'Cash' && <label className="reference-field"><span>Payment reference</span><input value={passenger.paymentReference} onChange={(event) => updatePassenger('paymentReference', event.target.value)} placeholder="Transaction or reference number" /></label>}

            <div className="payment-summary">
              <span><small>{selectedSeats.length} seat{selectedSeats.length === 1 ? '' : 's'} × {money(passenger.fare)}</small><strong>Total</strong></span>
              <b>{money(total)}</b>
              <span className={`balance ${paymentStatus.toLowerCase()}`}><small>{paymentStatus}</small><strong>{balance ? `${money(balance)} due` : 'Fully paid'}</strong></span>
            </div>

            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={resetForm}><RotateCcw size={16} /> Clear</button>
              <button type="submit" className="primary-button"><ReceiptText size={17} /> Save & preview ticket</button>
            </div>
          </section>

          <section className="seat-card">
            <div className="panel-heading seat-heading">
              <div className="title-with-step"><div><h2>Select seats</h2><p>{selectedSeats.length ? `Seats ${selectedSeats.join(', ')} selected` : 'Choose one or more available seats'}</p></div></div>
              <div className="seat-count">{selectedSeats.length}</div>
            </div>
            <div className="legend"><span><i className="available" />Available</span><span><i className="selected" />Selected</span><span><i className="booked" />Booked</span><span><i className="reserved" />Reserved</span></div>
            <div className="bus-shell">
              <div className="bus-front"><span><BusFront size={16} /> FRONT</span><span>DRIVER</span></div>
              <div className="seat-layout">
                {Array.from({ length: Math.ceil(bus.seats / 4) }, (_, rowIndex) => {
                  const seats = Array.from({ length: 4 }, (__, index) => rowIndex * 4 + index + 1).filter((seat) => seat <= bus.seats)
                  return <div className="seat-row" key={rowIndex}>
                    <div className="seat-pair">{seats.slice(0, 2).map((seat) => <SeatButton seat={seat} selectedSeats={selectedSeats} booked={activeBookedSeats.has(seat)} reserved={bus.reserved.includes(seat)} onSelect={toggleSeat} key={seat} />)}</div>
                    <span className="aisle">{rowIndex + 1}</span>
                    <div className="seat-pair">{seats.slice(2, 4).map((seat) => <SeatButton seat={seat} selectedSeats={selectedSeats} booked={activeBookedSeats.has(seat)} reserved={bus.reserved.includes(seat)} onSelect={toggleSeat} key={seat} />)}</div>
                  </div>
                })}
              </div>
            </div>
            <div className="seat-card-footer"><span><Armchair size={15} /> {bus.seats - tripBooked} available</span><strong>{money(total)}</strong></div>
          </section>
        </form>
        </div>

        <section className="panel bookings-card" id="reservations">
          <div className="bookings-header">
            <div><p className="eyebrow">COUNTER ACTIVITY</p><h2>Recent bookings</h2><p>Search, reprint or cancel tickets saved on this device.</p></div>
            <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ticket, passenger or CNIC" /></label>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Ticket</th><th>Passenger</th><th>Journey</th><th>Seat</th><th>Payment</th><th>Amount</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>{visibleBookings.length ? visibleBookings.map((item) => <tr className={item.bookingStatus === 'Cancelled' ? 'cancelled-row' : ''} key={item.id}>
                <td><strong>{item.ticketNo}</strong><small>{item.date} · {item.time}</small></td>
                <td><strong>{item.passenger}</strong><small>{item.phone}</small></td>
                <td><strong>{item.route}</strong><small>{item.bus} · {item.service}</small></td>
                <td><span className="seat-list">{item.seats.join(', ')}</span></td>
                <td><strong>{item.paymentMethod}</strong><small>{item.paymentStatus}</small></td>
                <td><strong>{money(item.total)}</strong><small>{item.balance ? `${money(item.balance)} due` : 'Settled'}</small></td>
                <td><span className={`status-badge ${item.bookingStatus.toLowerCase()}`}>{item.bookingStatus}</span></td>
                <td><div className="row-actions"><button type="button" aria-label={`Print ${item.ticketNo}`} title="Preview ticket" onClick={() => setReceipt(item)}><Printer size={15} /></button><button type="button" disabled={item.bookingStatus === 'Cancelled'} aria-label={`Cancel ${item.ticketNo}`} title="Cancel booking" onClick={() => cancelBooking(item.id)}><XCircle size={15} /></button></div></td>
              </tr>) : <tr><td className="empty-state" colSpan={8}><FileText size={24} /><strong>No bookings found</strong><span>Try a different search term.</span></td></tr>}</tbody>
            </table>
          </div>
        </section>
        </main>
      </div>

      {receipt && <ReceiptModal booking={receipt} onClose={() => setReceipt(null)} />}
      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </div>
  )
}

function SeatButton({ seat, selectedSeats, booked, reserved, onSelect }: { seat: number, selectedSeats: number[], booked: boolean, reserved: boolean, onSelect: (seat: number) => void }) {
  const selected = selectedSeats.includes(seat)
  const status = booked ? 'booked' : reserved ? 'reserved' : selected ? 'selected' : 'available'
  return <button type="button" disabled={booked || reserved} className={`seat seat--${status}`} aria-label={`Seat ${seat}, ${status}`} aria-pressed={selected} onClick={() => onSelect(seat)}><Armchair size={13} /><b>{seat}</b></button>
}

function ReceiptModal({ booking, onClose }: { booking: Booking, onClose: () => void }) {
  return <div className="receipt-overlay" role="dialog" aria-modal="true" aria-label={`Ticket ${booking.ticketNo}`}>
    <div className="receipt-modal">
      <div className="receipt-toolbar"><div><strong>Ticket preview</strong><small>80mm thermal receipt</small></div><button type="button" onClick={onClose} aria-label="Close ticket preview"><X size={18} /></button></div>
      <article className="receipt">
        <header><div className="receipt-logo">ME</div><h2>MADINA EXPRESS</h2><p>Safe journeys, every day</p><small>0311-777-2299 · Madina Terminal, Peshawar</small></header>
        <div className="receipt-rule" />
        <div className="ticket-heading"><span><small>TICKET NO.</small><strong>{booking.ticketNo}</strong></span><span className={`receipt-status ${booking.paymentStatus.toLowerCase()}`}>{booking.paymentStatus}</span></div>
        <div className="receipt-route"><span>{booking.route.split(' → ')[0]}</span><i>→</i><span>{booking.destination}</span></div>
        <div className="receipt-grid"><span><small>Departure</small><strong>{booking.date}<br />{booking.time}</strong></span><span><small>Bus / Service</small><strong>{booking.bus}<br />{booking.service}</strong></span><span><small>Passenger</small><strong>{booking.passenger}</strong></span><span><small>Seat number</small><strong className="large-seat">{booking.seats.join(', ')}</strong></span></div>
        <div className="receipt-rule" />
        <div className="receipt-line"><span>Fare</span><strong>{money(booking.fare * booking.seats.length)}</strong></div>
        <div className="receipt-line"><span>Discount</span><strong>- {money(booking.discount)}</strong></div>
        <div className="receipt-line total-line"><span>Total</span><strong>{money(booking.total)}</strong></div>
        <div className="receipt-line"><span>Paid via {booking.paymentMethod}</span><strong>{money(booking.paid)}</strong></div>
        {booking.balance > 0 && <div className="receipt-line due-line"><span>Balance due</span><strong>{money(booking.balance)}</strong></div>}
        <div className="receipt-barcode"><span /><small>{booking.ticketNo}</small></div>
        <div className="boarding-coupon"><strong>BOARDING COUPON</strong><span><small>Seat</small><b>{booking.seats.join(', ')}</b></span><span><small>Bus</small><b>{booking.bus}</b></span><span><small>Time</small><b>{booking.time}</b></span></div>
        <footer><p>Please arrive 30 minutes before departure.</p><small>Issued by Madina Express · {booking.driver} / {booking.attendant}</small></footer>
      </article>
      <div className="receipt-actions"><button className="secondary-button" type="button" onClick={onClose}>Close</button><button className="primary-button" type="button" onClick={() => window.print()}><Printer size={16} /> Print ticket</button></div>
    </div>
  </div>
}

export default App
