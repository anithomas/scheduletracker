// ─── SETTINGS / CONFIG ────────────────────────────────────────
// appConfig is only ever mutated in place (appConfig.appName = …), never
// rebound, so a plain export is enough for every module that imports it.
export let appConfig = {
  appName: 'Family Household Tracker',
  logoEmoji: '🏠',
  defaultTaxRate: 13,
  currency: '$',
  authorizedUsers: [] as any[],
  reminderSettings: {
    enabled: true,
    leadTimes: [1, 7],           // days before: 1 day, 1 week (configurable in Admin)
    channels: { inApp: true, push: true },
  },
};

// These six, by contrast, get reassigned wholesale (`appVehicles = …`) from
// other modules (vehicles.ts, member-prefs.ts, rbac.ts, admin-catalog.ts) —
// something only the declaring module can do to an exported `let` binding —
// so each gets a setter those modules call instead.
export let currentUserRole = 'admin';
export function setCurrentUserRole(v: string) { currentUserRole = v; }

export let appVehicles = [
  {id:'v1',name:'Nissan Rogue',make:'Nissan',model:'Rogue',trim:'SV AWD 2.5L',year:'2019',emoji:'🚙',color:'#0b1f3a',plate:'',vin:''},
  {id:'v2',name:'Highlander',make:'Toyota',model:'Highlander',trim:'XLE V6 3.5L',year:'2020',emoji:'🚐',color:'#071427',plate:'',vin:''},
] as any[];
export function setAppVehicles(v: any[]) { appVehicles = v; }

export let appMembers = [
  {id:'m1',name:'Ani',color:'#0b1f3a'},
  {id:'m2',name:'Anju',color:'#e76f51'},
  {id:'m3',name:'Kevin',color:'#2c8a5d'},
  {id:'m4',name:'Rachel',color:'#d9a441'},
] as any[];
export function setAppMembers(v: any[]) { appMembers = v; }

export let homeCategories = ['HVAC','Appliances','Plumbing','Electrical','Lawn & Garden','Cleaning','Pest Control','Other'];
export function setHomeCategories(v: string[]) { homeCategories = v; }

export let serviceTypes = ['Oil Change','Tire Rotation','Tire Pressure Check','Brake Inspection','Brake Pad Replacement','Air Filter','Cabin Filter','Coolant Flush','Transmission Fluid','Battery Check/Replace','Other'];
export function setServiceTypes(v: string[]) { serviceTypes = v; }

export let eventTypes = [
  {value:'medical', emoji:'🏥', label:'Medical'},
  {value:'vehicle', emoji:'🚗', label:'Vehicle'},
  {value:'home',    emoji:'🏡', label:'Home'},
  {value:'school',  emoji:'🏫', label:'School'},
  {value:'general', emoji:'📌', label:'General'},
  {value:'other',   emoji:'📎', label:'Other'},
] as any[];
export function setEventTypes(v: any[]) { eventTypes = v; }

export const VEHICLE_COLORS = ['#0b1f3a','#071427','#1f6f4a','#2c8a5d','#334155','#64748b','#96690f','#d9a441','#a03d24','#e76f51','#4a5f7a','#164a33'];
