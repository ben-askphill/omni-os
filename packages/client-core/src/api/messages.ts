import type { MessageContext } from '@omni/shared/message-context.ts';
import type { Answer, AnswerPayload, QuestionState } from '@omni/shared/question.ts';
import { apiPath, sendWithFiles, type HttpClient, type WithFiles } from '../http.ts';
import type { Thread } from './threads.ts';

export interface Attachment {
  name: string;
  path: string;
  size: number;
  mime: string;
  image: boolean;
}

/** How a message reaches a busy thread: read at its next step, run after the turn, or interrupt then run. */
export type SendMode = 'steer' | 'queue' | 'interrupt';

export type DeliveryState = 'accepted' | 'waiting' | 'held' | 'sent' | 'delivered' | 'dropped' | 'discarded' | 'cancelled' | 'recovered' | 'uncertain';

/** A message the agent has not read yet. */
export interface PendingMsg {
  uuid: string;
  kind: 'user' | 'crew_report';
  text: string;
  source?: string;
  mode: SendMode;
  state: 'waiting' | 'sent' | 'held';
  task_id?: string | null;
  role?: string | null;
  thread_id?: string;
  attachments?: Attachment[];
  context?: unknown;
  request_id?: string;
  delivery?: DeliveryState;
}

/** What the server says once a message is saved. A retry with the same `request_id` gets the same answer back. */
export interface Acceptance {
  id: string;
  request_id: string;
  state: DeliveryState;
  accepted_at: string;
  /** This `request_id` was accepted before: nothing new was saved or sent. */
  duplicate?: true;
}

export type PostedThread = Thread & { request: Acceptance };

/** One row of GET /threads/:id/requests: a message the server accepted, by the id the client sent it under. */
export interface MessageRequestRow {
  id: string;
  request_id: string;
  state: DeliveryState;
}

/** POST /threads/:id/messages. A prompt, context, or both. Files go beside it as a second argument to `sendMessage`. */
export interface SendMessageRequest {
  prompt: string;
  /** Left out: `steer`. */
  mode?: SendMode;
  /** The client's id for this send, kept across its retries, 1 to 200 characters. */
  request_id?: string;
  context?: readonly MessageContext[];
}

/** A refused answer is a 409 whose body carries the state the first answer left. */
export type AnswerResult = { state: QuestionState; via: AnswerPayload['via'] };

export function messagesApi(http: HttpClient) {
  return {
    /**
     * Send with a `request_id` and retry with the same one: the second answer is the first, marked `duplicate`. With
     * `files` the message goes as multipart, and the retry must send the same files for the server to call it a retry.
     */
    sendMessage: (id: string, body: SendMessageRequest, withFiles?: WithFiles) =>
      sendWithFiles<PostedThread>(http, 'POST', apiPath`/threads/${id}/messages`, body, withFiles),
    /** One answer per question, null to skip it. */
    answerQuestion: (id: string, questionId: string, answers: readonly Answer[]) =>
      http.request<AnswerResult>('POST', apiPath`/threads/${id}/questions/${questionId}/answer`, { body: { answers } }),
    stop: (id: string) => http.request<Thread>('POST', apiPath`/threads/${id}/stop`),
    /** The thread's accepted messages, newest first. A user row on the stream carries no `request_id`, so this is how a client learns whether its own send landed. */
    requests: (id: string) => http.request<MessageRequestRow[]>('GET', apiPath`/threads/${id}/requests`),
  };
}
