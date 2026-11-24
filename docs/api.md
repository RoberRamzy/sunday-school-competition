# Shared API contract

All browser calls use same-origin /api, JSON, credentials and private no-store responses. The API validates Origin against PUBLIC_ORIGIN on mutations. Session cookie sid is opaque, HttpOnly, SameSite=Lax, Path=/ and Secure in production. Only its digest is persisted. Successful login rotates the session atomically. Use UUIDs for IDs.

| Method and path (under /api) | Request | Success |
|---|---|---|
| GET /auth/grades | — | array of {id,name} |
| GET /auth/grades/:gradeId/students | — | array of {id,displayLabel} |
| POST /auth/activate | {gradeId,studentId,activationCode,pin} | principal |
| POST /auth/login | {gradeId,studentId,pin} | principal |
| POST /auth/staff-login | {username,password} | principal |
| GET /auth/me | — | principal or 401 |
| POST /auth/logout | {} | 204 |
| POST /admin/grades/:gradeId/activation-handout | {studentIds: string[]} | XLSX, Name and One-time password columns |
| GET /appearance | — | {theme:"classic" or "christmas"} |
| PUT /admin/appearance | {theme} | {theme} |

Principal is {id, displayName, role: "STUDENT" or "SERVANT" or "SUPER_ADMIN", gradeId?: string}. PIN is a string of six ASCII digits. Form errors use HTTP status (400 invalid fields, 401 generic invalid credentials, 403 scope, 429 throttled). Grade and label pair is unique. Activation code digest, consumed timestamp and PIN hash are separate nullable student fields. Generate high-entropy codes at export and verify against the selected pending record. Conditional activation, session rotation and credential consumption commit together. Serialize concurrent login per student. Never return hashes, codes or account status from public roster endpoints.

Attempt lifecycle, replacement uniqueness, frozen quiz sets, serialization of writes and deadline reconciliation follow sections 6, 8, 9.4, 14 and 17 of the implementation plan.

Staff roster endpoints require a staff principal. GET /admin/students?gradeId= returns an array of {id,gradeId,fullName,displayLabel,status}. POST /admin/students and PATCH /admin/students/:id accept {gradeId,fullName,displayLabel,status?} (patch partial). POST /admin/students/import accepts {gradeId,students:[{fullName,displayLabel}],dryRun:boolean}; parse CSV/XLSX locally and validate all rows server-side before atomic commit. Return {count}. POST /admin/students/:id/reset-pin {} revokes sessions and returns the student to pending so staff can issue a fresh handout. Super admins manage records, servants can list, issue handouts and reset only assigned-grade students. GET /admin/grades returns the same shape as /auth/grades restricted to staff grade scope.

POST /admin/grades and PATCH /admin/grades/:id accept {name}. GET /admin/servants lists {id,fullName,username,status,gradeIds}. POST /admin/servants accepts {fullName,username,password,gradeIds}; PATCH /admin/servants/:id accepts partial updates and status. These management actions require SUPER_ADMIN.

## Competitions and attempts

- GET/POST /admin/questions, PATCH/DELETE /admin/questions/:id. Question fields {id,gradeId,type:"MCQ"|"SORTING",difficulty:"EASY"|"MEDIUM"|"HARD",text,points,imageUrl?,explanation?,tags,items:[{id,text}],correctOrder:string[],sortingMode:"PARTIAL"|"EXACT",archived}. MCQ correctOrder contains one item ID. Sorting correctOrder is a permutation. For create omit id and archived; PATCH can update editable fields. DELETE archives.
- GET /admin/competitions lists eligible staff-visible summaries. POST /admin/competitions and PATCH /admin/competitions/:id use {title,description?,instructions,opensAt,closesAt,durationMinutes,tiePolicy?,grades:[{gradeId,questionIds,blueprint:[{type,difficulty,count}]}]}. GET detail returns these fields plus id,status,publishedAt. Dates are ISO UTC. POST actions /activate, /close, /publish, /archive with {}. Drafts are editable and activation validates and freezes the selected sets. Clock derives scheduled/open eligibility. Rank within each grade using tiePolicy (SCORE_THEN_TIME by default, or SCORE_ONLY).
- GET /admin/competitions/:id/monitoring returns {counts:{notStarted,inProgress,completed,timedOut},students:[{studentId,displayLabel,gradeId,attemptId,status,score,maxScore}]}. GET /results returns the same scoped rows with rank after publication for servants (admins can preview); GET /results/export?format=csv|xlsx downloads results. POST /admin/attempts/:id/authorize-replacement {reason}; POST /admin/attempts/:id/flag {reason}; GET /admin/attempts/:id includes status, timestamps and audit events. All staff reads are grade scoped.
- GET /student/competitions (also /student/dashboard) lists {id,title,description,instructions,opensAt,closesAt,durationMinutes,questionCount,status,attemptId,attemptStatus,result}. result is null until publication or {score,maxScore,rank}. GET /student/competitions/:id gives the same item.
- POST /competitions/:id/start {}, GET /student/attempts/:id and GET /attempts/:id/status return {id,competitionId,status,expiresAt,serverTime,index,total,question,savedAnswer,revision}. question is null for terminal states, otherwise {id,type,text,imageUrl?,items:[{id,text}]}. Only the current question is visible; no answer keys. savedAnswer is null or array of item IDs (single for MCQ).
- POST /attempts/:id/answers {questionId,itemIds:string[],advance:boolean,revision:number} saves the current answer and optionally locks and advances in one operation. Use positive monotonic revisions per question. Reject stale/different data, return current attempt state on replay of a committed advance. POST /attempts/:id/submit {} finalizes. Return the attempt state from each mutation, including if the deadline has just finalized it. Reject other integrity conflicts with 409.
