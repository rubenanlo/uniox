/**
 * On-demand AI cards on Home. Each card is made only when the user asks for it
 * (⌘. menu or ⌘J palette), saved for the rest of the day, and reused until
 * refreshed: opening Home never calls Claude.
 */
export type AiCardKind = 'meetings' | 'tasks' | 'reply' | 'news';

/** Left-to-right order of the cards under the Home timeline. */
export const AI_CARD_ORDER: AiCardKind[] = ['meetings', 'tasks', 'reply', 'news'];

export interface ReplyItem {
  threadId: string;
  who: string;
  /** What they are waiting on, in a few words. */
  ask: string;
  /** When their message arrived. */
  at: number;
}

export interface ReplyCard {
  items: ReplyItem[];
}

export type TaskBucket = 'overdue' | 'today' | 'week' | 'later' | 'none';

export interface TaskItem {
  id: string;
  title: string;
  url: string;
  due: string | null;
  bucket: TaskBucket;
  why?: string;
}

export interface TasksCard {
  overdue: number;
  today: number;
  total: number;
  top: TaskItem[];
  /** The Notion person the list was filtered to, if any. */
  assignee?: string;
}

export interface NewsStory {
  title: string;
  blurb: string;
  url?: string;
  theme: string;
  sources: string[];
}

export interface NewsCard {
  editions: string[];
  /** The newsletter threads the digest was made from (for "Archive the emails"). */
  threads: { id: string; accountId: string }[];
  stories: NewsStory[];
  merged: number;
}

export type ResourceKind = 'doc' | 'sheet' | 'slides' | 'drive' | 'notion' | 'link' | 'task';

export interface PrepResource {
  title: string;
  url: string;
  kind: ResourceKind;
  /** Where it was found ("in the invite", "Helen's email"). */
  from: string;
}

export interface PrepPerson {
  name: string;
  email: string;
  lastSubject?: string;
  lastAt?: number;
  threadId?: string;
}

export interface PrepThread {
  id: string;
  subject: string;
  who: string;
  count: number;
  at: number;
}

export interface MeetingPrep {
  eventId: string;
  title: string;
  startMs: number;
  endMs: number;
  meetingUrl?: string;
  attendeeCount: number;
  about: string;
  open: string;
  bring: string;
  people: PrepPerson[];
  resources: PrepResource[];
  threads: PrepThread[];
}

export interface MeetingsCard {
  meetings: MeetingPrep[];
}

export interface AiCardData {
  meetings: MeetingsCard;
  tasks: TasksCard;
  reply: ReplyCard;
  news: NewsCard;
}

export type SavedCards = {
  [K in AiCardKind]?: { madeAt: number; data: AiCardData[K] };
};

/** What lives in the `aiCards` setting: today's cards only. */
export interface SavedCardsDay {
  day: string;
  cards: SavedCards;
}
