import Link from "next/link";
import type { IssueComment } from "@/lib/comment-view";
import type { IssueAnswer, IssueView } from "@/lib/issue-view";
import { formatAudioDuration } from "@/lib/audio-validation";
import { issueTitle } from "@/lib/issue-name";
import { reactionSummary } from "@/lib/print-view";
import { printThemeCss, resolveTheme } from "@/lib/theme";
import { Avatar } from "@/components/avatar";
import { LoopBanner } from "@/components/loop-theme";
import { DocumentTitle } from "@/components/document-title";
import { copy, text } from "@/lib/copy";
import { PrintButton } from "./print-button";

/**
 * A delivered round as paper. The web round is canonical; this reads the same view
 * and only changes how it is laid out: no buttons, no players, no composers, light
 * paper whatever the screen is doing, and page breaks where a page should end.
 *
 * Authors are always named (never "You"): a keepsake is read by someone else.
 */
export function IssuePrint({
  view,
  roundTemplate,
  eyebrow,
  answersLine,
  deliveredLine,
  backHref,
}: {
  view: IssueView;
  /** "Round {number}", from the surface's own copy. */
  roundTemplate: string;
  eyebrow: string;
  answersLine: string;
  deliveredLine: string;
  backHref: string;
}) {
  const { group, issue } = view;
  const title = issueTitle(roundTemplate, issue.number, issue.name);
  const answered = view.blocks.filter((block) => block.answers.length > 0);
  const sections = view.sections.filter((section) => section.replies.length > 0);
  const paper = printThemeCss(resolveTheme({ preset: group.themePreset, accent: group.themeAccent }));

  return (
    <div className="print-sheet">
      <style dangerouslySetInnerHTML={{ __html: paper }} />
      <DocumentTitle value={text(copy.print.documentTitle, { title, loop: group.name })} />
      <div className="print-wrap">
        <nav aria-label={copy.print.toolbarLabel} className="print-toolbar no-print">
          <Link href={backHref} className="print-back">
            {copy.print.back}
          </Link>
          <PrintButton />
          <p className="print-hint">{copy.print.hint}</p>
        </nav>

        <header className="print-masthead">
          <LoopBanner url={group.headerImageUrl} className="mb-3" />
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="text-ink">{title}</h1>
          <p className="print-meta">
            {group.name} · {text(roundTemplate, { number: issue.number })}
          </p>
          <p className="print-meta">{answersLine}</p>
          <p className="print-meta">{deliveredLine}</p>
        </header>

        <main>
          {answered.map((block, index) => (
            <section key={block.questionId} className="print-question">
              <h2 className="flex items-start gap-3 text-ink">
                <span className="question-number numeric">{index + 1}</span>
                {block.emoji ? <span className="mr-1">{block.emoji}</span> : null}
                {block.question}
              </h2>
              {block.description ? <p className="print-credit">{block.description}</p> : null}
              {block.suggestedBy ? (
                <p className="print-credit">{text(copy.issue.askedBy, { name: block.suggestedBy })}</p>
              ) : null}
              {block.poll?.tally ? (
                <div className="print-poll">
                  <p className="print-poll-title numeric">
                    {copy.polls.issue.results} ·{" "}
                    {block.poll.voters === 1
                      ? copy.polls.issue.votesOne
                      : text(copy.polls.issue.votesMany, { count: block.poll.voters ?? 0 })}
                  </p>
                  <ul aria-label={copy.polls.issue.results}>
                    {block.poll.tally.map((row) => (
                      <li key={row.option}>
                        <span>{row.option}</span>
                        <span className="numeric">{row.votes}</span>
                        <span className="poll-bar" aria-hidden="true">
                          <span
                            style={{
                              width: `${block.poll?.voters ? Math.round((row.votes / block.poll.voters) * 100) : 0}%`,
                            }}
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {block.answers.map((answer) => (
                <PrintAnswer key={answer.replyId} answer={answer} />
              ))}
            </section>
          ))}

          {sections.map((section, sectionIndex) => (
            <section key={section.id} className="print-question">
              <h2 className="flex items-start gap-3 text-ink">
                <span className="question-number numeric">{answered.length + sectionIndex + 1}</span>
                <span>
                  {section.emoji ? <span className="mr-1">{section.emoji}</span> : null}
                  {section.title}
                </span>
              </h2>
              {section.description ? <p className="print-credit">{section.description}</p> : null}

              {section.kind === "photo_wall" ? (
                <div className="print-wall">
                  {section.replies.flatMap((reply) =>
                    reply.media.map((item) => (
                      <figure key={item.url} className="print-figure">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.url} alt={item.caption ? "" : text(copy.issue.photoAlt, { author: reply.author })} />
                        <figcaption>
                          <strong>{reply.author}</strong>
                          {item.caption ? `, ${item.caption}` : null}
                        </figcaption>
                      </figure>
                    )),
                  )}
                </div>
              ) : (
                section.replies.map((reply) => (
                  <article key={reply.replyId} className="print-answer">
                    <h3 className="print-author">
                      <Avatar name={reply.author} photoUrl={reply.authorPhotoUrl} frame={reply.authorFrame} eager />
                      <span>{reply.author}</span>
                    </h3>
                    {reply.body ? <p className="print-body">{reply.body}</p> : null}
                    {reply.linkUrl ? (
                      <div className="print-card">
                        <p className="print-card-title">{reply.linkTitle ?? reply.linkUrl}</p>
                        <p className="print-card-meta capitalize">{reply.linkProvider}</p>
                        <p className="print-card-link">{reply.linkUrl}</p>
                        {reply.linkTrackCount > 1 && reply.linkTracks.length > 0 ? (
                          <ol className="print-card-tracks">
                            {reply.linkTracks.slice(0, 5).map((track, index) => (
                              <li key={`${index}-${track.title}`}>{track.title}</li>
                            ))}
                          </ol>
                        ) : null}
                      </div>
                    ) : null}
                    {reply.media.map((item) => (
                      <figure key={item.url} className="print-figure">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.url} alt={item.caption || text(copy.issue.photoAlt, { author: reply.author })} />
                      </figure>
                    ))}
                    {reply.addedLater ? <p className="print-late">{copy.print.late}</p> : null}
                    <PrintConversation reactions={reply.reactions} comments={reply.comments} />
                  </article>
                ))
              )}
            </section>
          ))}

          {view.commentsEnabled && view.comments.length > 0 ? (
            <section className="print-question">
              <h2 className="text-ink">{copy.print.commentsHeading}</h2>
              <CommentList comments={view.comments} />
            </section>
          ) : null}
        </main>

        <footer className="print-footer">{text(copy.print.footer, { brand: copy.common.brand })}</footer>
      </div>
    </div>
  );
}

function PrintAnswer({ answer }: { answer: IssueAnswer }) {
  return (
    <article className="print-answer">
      <h3 className="print-author">
        <Avatar name={answer.author} photoUrl={answer.authorPhotoUrl} frame={answer.authorFrame} eager />
        <span>{answer.author}</span>
      </h3>
      {answer.choices.length > 0 ? (
        <ul className="print-choices" aria-label={text(copy.polls.issue.chose, { choices: answer.choices.join(", ") })}>
          {answer.choices.map((choice) => (
            <li key={choice} className="chip border bg-accent-soft px-2.5 py-1 text-[13px] font-bold text-accent-ink">
              {choice}
            </li>
          ))}
        </ul>
      ) : answer.body || !(answer.link || answer.media) ? (
        <p className="print-body">{answer.body}</p>
      ) : null}
      {answer.link ? <PrintMusic link={answer.link} /> : null}
      {(answer.media ?? []).map((item) => (
        <figure key={item.url} className="print-figure">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.url} alt={item.caption ? "" : text(copy.issue.photoAlt, { author: answer.author })} />
          {item.caption ? <figcaption>{item.caption}</figcaption> : null}
        </figure>
      ))}
      {answer.photoUrl ? (
        <figure className="print-figure">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={answer.photoUrl} alt={text(copy.issue.photoAlt, { author: answer.author })} />
        </figure>
      ) : null}
      {answer.audioUrl ? (
        <div className="print-card">
          <p className="print-card-title">
            <span aria-hidden="true">🎙 </span>
            {text(copy.print.voiceCard, { duration: formatAudioDuration(answer.audioDurationMs ?? 0) })}
          </p>
        </div>
      ) : null}
      {answer.addedLater ? <p className="print-late">{copy.print.late}</p> : null}
      <PrintConversation reactions={answer.reactions} comments={answer.comments} />
    </article>
  );
}

/** A music pick on paper: its title, where it lives, and the link to type in. */
function PrintMusic({ link }: { link: NonNullable<IssueAnswer["link"]> }) {
  return (
    <div className="print-card">
      <p className="print-card-title">{link.title ?? link.url}</p>
      <p className="print-card-meta capitalize">{link.provider}</p>
      <p className="print-card-link">{link.url}</p>
      {link.trackCount > 1 && link.tracks.length > 0 ? (
        <ol className="print-card-tracks">
          {link.tracks.slice(0, 5).map((track, index) => (
            <li key={`${index}-${track.title}`}>{track.title}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** An answer's reactions and thread, when it has any. */
function PrintConversation({ reactions, comments }: Pick<IssueAnswer, "reactions" | "comments">) {
  const summary = reactionSummary(reactions);
  return (
    <>
      {summary ? (
        <p className="print-reactions numeric">{text(copy.print.reactions, { summary })}</p>
      ) : null}
      {comments.length > 0 ? (
        <div className="print-thread" role="group" aria-label={copy.print.answerComments}>
          <CommentList comments={comments} />
        </div>
      ) : null}
    </>
  );
}

function CommentList({ comments }: { comments: IssueComment[] }) {
  return (
    <div>
      {comments.map((comment) => (
        <div key={comment.id} className="print-comment">
          <p className="print-comment-author">
            <Avatar name={comment.author} photoUrl={comment.authorPhotoUrl} frame={comment.authorFrame} className="!h-6 !w-6 !text-[11px]" eager />
            <span>{comment.author}</span>
          </p>
          {comment.quote ? (
            <blockquote className="comment-quote">
              {comment.quote.removed ? (
                <p className="italic">{comment.quote.text}</p>
              ) : (
                <>
                  <p className="font-bold">{text(copy.issue.quoteBy, { author: comment.quote.author })}</p>
                  <p>{comment.quote.text}</p>
                </>
              )}
            </blockquote>
          ) : null}
          {comment.parts.length > 0 ? (
            <p className="print-body">
              {comment.parts.map((part, index) =>
                part.type === "mention" ? (
                  <span key={index} className="mention">@{part.name}</span>
                ) : (
                  <span key={index}>{part.text}</span>
                ),
              )}
            </p>
          ) : null}
          {comment.photoUrl ? (
            <figure className="print-figure">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={comment.photoUrl} alt={text(copy.issue.commentPhotoAlt, { author: comment.author })} />
            </figure>
          ) : null}
        </div>
      ))}
    </div>
  );
}
