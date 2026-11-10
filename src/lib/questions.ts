// Offline question bank for open interviews: Anuradhapura-wide questions, one set per research theme (subgroup)
// and one per elective, plus neutral probes. Sinhala first (what the student reads out), English underneath.
import type { FollowUp } from './ai'

export const COMMON: FollowUp[] = [
  { si: 'ඔබ මේ ප්‍රදේශයේ ජීවත් වෙන්නේ (නැත්නම් වැඩ කරන්නේ) කොච්චර කාලයක ඉඳන්ද?', en: 'How long have you lived (or worked) in this area?' },
  { si: 'පසුගිය අවුරුදු 10-20 තුළ අනුරාධපුරය වෙනස් වුණේ කොහොමද?', en: 'How has Anuradhapura changed over the last 10–20 years?' },
  { si: 'පූජා නගරයට ළඟින් ජීවත් වීම ඔබේ එදිනෙදා ජීවිතයට බලපාන්නේ කොහොමද?', en: 'How does living near the sacred city affect your daily life?' },
  { si: 'වන්දනාකරුවන් සහ සංචාරකයින් මේ ප්‍රදේශයට බලපාන්නේ කොහොමද?', en: 'How do pilgrims and tourists affect this area?' },
  { si: 'මෙහි මිනිසුන්ට වැව් කොච්චර වැදගත්ද?', en: 'How important are the tanks (wewa) to people here?' },
  { si: 'මේ ප්‍රදේශයේ තියෙන ලොකුම ප්‍රශ්න මොනවද?', en: 'What are the biggest problems in this neighbourhood?' },
  { si: 'මේ ස්ථානයේ ඔබ වැඩියෙන්ම අගය කරන්නේ මොනවද?', en: 'What do you value most about this place?' },
  { si: 'අනුරාධපුරයේ එක දෙයක් වෙනස් කරන්න පුළුවන් නම්, ඒ මොකක්ද?', en: 'If you could change one thing in Anuradhapura, what would it be?' },
]

export const BY_THEME: Record<string, FollowUp[]> = {
  Social: [
    { si: 'මේ ප්‍රජාවේ උදව්වක් ඕන වුණාම ඔබ යන්නේ කා ළඟටද?', en: 'Who do you turn to for help in this community?' },
    { si: 'මිනිස්සු එකතු වෙලා කාලය ගත කරන තැන් මෙහි තියෙනවද?', en: 'Are there places where people meet and spend time together?' },
    { si: 'පාසල්, රෝහල් වගේ සේවාවලට යන්න කොච්චර පහසුද?', en: 'How easy is it to reach schools, hospitals and other services?' },
    { si: 'තරුණයෝ මෙහෙම ඉන්නවද, නැත්නම් වෙන තැන්වලට යනවද? ඇයි?', en: 'Do young people stay here or move away? Why?' },
    { si: 'දවල්ට වගේම රෑටත් මෙහි ආරක්ෂිතයි කියලා ඔබට හිතෙනවද?', en: 'Do you feel safe here, during the day and at night?' },
    { si: 'මෙහි විවිධ ප්‍රජාවන් එකට ජීවත් වෙන්නේ කොහොමද?', en: 'How do different communities get along here?' },
  ],
  Economic: [
    { si: 'ඔබේ ජීවනෝපාය මොකක්ද, ඒක වෙනස් වුණේ කොහොමද?', en: 'What do you do for a living, and how has it changed?' },
    { si: 'ඔබේ ආදායම වන්දනාකරුවන් සහ සංචාරකයින් මත කොච්චර රඳා පවතිනවද?', en: 'How much does your income depend on pilgrims and tourists?' },
    { si: 'මෙහි ව්‍යාපාරයක් කරගෙන යාම අමාරු වෙන්නේ මොන හේතු නිසාද?', en: 'What makes it hard to run a business here?' },
    { si: 'පෝය, උත්සව කාල වගේ කාලවලට අනුව ඔබේ ආදායම වෙනස් වෙන්නේ කොහොමද?', en: 'How do poya days and festival seasons change your earnings?' },
    { si: 'ඔබ බඩු ගන්නේ සහ විකුණන්නේ කොහෙන්ද?', en: 'Where do you buy and sell goods?' },
    { si: 'ගොවිතැන හෝ වැව් ජලය භාවිතය වෙනස් වුණේ කොහොමද?', en: 'How has farming or the use of tank water changed?' },
  ],
  Cultural: [
    { si: 'පූජා නගරය ඔබට පුද්ගලිකව අදහස් කරන්නේ මොකක්ද?', en: 'What does the sacred city mean to you personally?' },
    { si: 'පූජා කටයුතු හෝ උත්සව සඳහා මෙහි වැදගත්ම ස්ථාන මොනවද?', en: 'Which places here matter most for rituals or festivals?' },
    { si: 'උරුම නීති නිසා ඔබට ඉදිකරන්න හෝ කරන්න පුළුවන් දේවල්වලට බලපෑම් වෙන්නේ කොහොමද?', en: 'How do heritage rules affect what you can build or do?' },
    { si: 'නැති වෙලා යන සම්ප්‍රදායන් මොනවද, තවමත් පවතින ඒවා මොනවද?', en: 'Which traditions are being lost, and which are kept alive?' },
    { si: 'අමුත්තන් පූජනීය ස්ථානවලට ගරු කරන්නේ කොහොමද?', en: 'How do visitors treat the sacred places?' },
  ],
  Political: [
    { si: 'මේ ප්‍රදේශය සංවර්ධනය කරන හැටි ගැන තීරණ ගන්නේ කවුද?', en: 'Who makes decisions about how this area develops?' },
    { si: 'මෑතකදී මෙහි කළ ව්‍යාපෘතියක් ගැන ඔබේ අදහස් ඇහුවද?', en: 'Were you asked for your opinion on any recent project here?' },
    { si: 'ප්‍රාදේශීය සභාවෙන් හෝ නගර සභාවෙන් උදව් ගන්න කොච්චර පහසුද?', en: 'How easy is it to get help from the Pradeshiya Sabha or Municipal Council?' },
    { si: 'ඉඩම් අයිතිය හෝ නැවත පදිංචි කිරීමේ ප්‍රශ්න ඔබට හෝ ඔබ දන්න අයට බලපෑවාද?', en: 'Have land ownership or relocation issues affected you or people you know?' },
    { si: 'ඔබේ එදිනෙදා ජීවිතයට වැඩියෙන්ම බලපාන නීති රීති මොනවද?', en: 'Which rules or regulations affect your daily life the most?' },
  ],
}

export const BY_ELECTIVE: Record<string, FollowUp[]> = {
  Ecology: [
    { si: 'මෙහි වැව්, ඇළ මාර්ග සහ ගස් වෙනස් වුණේ කොහොමද?', en: 'How have the tanks, canals and trees here changed?' },
    { si: 'ගංවතුර, නියඟය හෝ තද රස්නය නිසා ප්‍රශ්න තියෙනවද?', en: 'Do you face problems with floods, drought or heat?' },
    { si: 'මේ ප්‍රදේශයේ කසළ කළමනාකරණය කරන්නේ කොහොමද?', en: 'How is waste managed in this area?' },
    { si: 'වන සතුන් (අලි, වඳුරෝ) නිසා මෙහි ප්‍රශ්න ඇති වෙනවද?', en: 'Do wild animals (elephants, monkeys) cause problems here?' },
  ],
  Housing: [
    { si: 'ඔබ මේ නිවසේ ජීවත් වෙන්න ආවේ කොහොමද?', en: 'How did you come to live in this house?' },
    { si: 'ඔබේ නිවාස තත්ත්වය වැඩිදියුණු කරන්න මොනවද ඕන?', en: 'What would make your housing better?' },
    { si: 'තරුණ පවුල්වලට මෙහි ගෙවල් දරාගන්න පුළුවන්ද?', en: 'Can young families afford houses here?' },
    { si: 'මෙහි ජලය, විදුලිය සහ කාණු පද්ධතිය කොහොමද?', en: 'How are water, electricity and drainage here?' },
  ],
  'Land Use': [
    { si: 'කාලයත් එක්ක මෙහි ඉඩම් භාවිත කළේ කොහොමද?', en: 'How has the land around here been used over time?' },
    { si: 'දැන් ගොඩනැගිලි හදන්නේ මොන ඉඩම්වලද, කවුද හදන්නේ?', en: 'Which land is being built on now, and by whom?' },
    { si: 'කලාපකරණය හෝ පූජා භූමි සීමා මෙහි ඉඩම්වලට බලපාන්නේ කොහොමද?', en: 'How do zoning or sacred-area limits affect land here?' },
    { si: 'ඔබ ගමන් කරන්නේ කොහොමද: පාරවල්, බස්, පයින්?', en: 'How do you get around: roads, buses, walking?' },
  ],
}

/** Suggested topics per theme for the setup screen (one tap fills the topic). */
export const TOPICS: Record<string, string[]> = {
  Social: ['Community life', 'Access to services', 'Safety'],
  Economic: ['Livelihoods', 'Pilgrim & tourist economy', 'Small businesses'],
  Cultural: ['Living with heritage', 'Rituals & festivals', 'Sacred city rules'],
  Political: ['Local decision-making', 'Land & relocation', 'Public participation'],
}

export interface QuestionSet {
  id: string
  label: string
  questions: FollowUp[]
}

/** Sets shown during an interview, the student's own theme first. */
export function questionSets(theme: string | null, elective: string | null, probes: FollowUp[]): QuestionSet[] {
  const sets: QuestionSet[] = []
  if (theme && BY_THEME[theme]) sets.push({ id: 'theme', label: theme, questions: BY_THEME[theme] })
  if (elective && BY_ELECTIVE[elective]) sets.push({ id: 'elective', label: elective, questions: BY_ELECTIVE[elective] })
  sets.push({ id: 'common', label: 'Anuradhapura', questions: COMMON })
  sets.push({ id: 'probes', label: 'Dig deeper', questions: probes })
  // Students without a theme (or the admin) can still browse every theme.
  if (!theme) for (const [t, qs] of Object.entries(BY_THEME)) sets.splice(sets.length - 2, 0, { id: `t-${t}`, label: t, questions: qs })
  return sets
}
