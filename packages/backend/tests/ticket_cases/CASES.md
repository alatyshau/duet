# Ticket tool test cases

Each behavior of `tickets`, `new_ticket`, `move_ticket`, and `edit_ticket` is a folder you can review without reading any code. To change behavior, update the case first, then the code.

## Anatomy of a case

- `tree.txt`: name of the shared tree in `trees/` that the case starts from. A case has its own `before/` folder instead only when it needs a layout that no shared tree provides.
- `call.txt`: the call, on one line.
- `expected.md`: the exact response the tool must return. `{root}` stands for the directory containing the business.
- `after/`: the files the call creates or modifies, and nothing else.
- `removed.txt`: the folders the call removes from their original location.
- `today.txt`: the date of the call, if it isn't 2026-10-08.

A case with neither `after/` nor `removed.txt` must leave the disk untouched.

A case whose name contains `_error_` must fail: the result is flagged as an error, the response starts with `Error:`, and the disk is untouched. Every other case must succeed. A response includes `**Index:**`, an address like `@DUE008/INDEX.md` that stays valid when the ticket is moved or renamed.

Some behavior can't be expressed as files: a write that fails halfway, file permissions, and reads that overlap a move. Those are covered by `TestRollback`, `TestConcurrency`, and `TestMcpBoundary` in `tests/test_ticket_cases.py`.

## Shared trees

Starting data is defined once, in `trees/`. Changing a shared tree changes the expected output of every case that uses it.

`trees/empty` is the DuetLab business (code DUE) with no tickets.

`trees/lab` is the DuetLab business (code DUE) with:

- `DUEX01 ShellPrototype`: active program with an icon and a description. `DUE004` and `DUE007 UIResearch` are in work; `DUE030` is in the backlog, inside the `backlog/shell` grouping folder.
- `DUEX02 WorkDoctrine`: active program with a description. In work: `DUE008` (has a description and body content), `DUE011` (renamed once), `DUE024` (closed once, then reopened). In the backlog: `DUE014`. Archived: `DUE013` and `DUE019` (closed twice).
- `DUEX04 DuetVision`: active program whose only ticket, `DUE012`, is in the backlog.
- `DUEX06 Marketplace`: active program with no tickets.
- `DUEX05 DuetSkills`: program in the backlog. `DUE027` is in the backlog; `DUE021` is archived.
- `DUEX03 WorkSupport`: closed program. `DUE017` and `DUE036` are archived; `DUE036` is the highest project number in the business.
- `DUEA01 Curation`: active process with no tickets. `DUEA02 Migration`: closed process.
- No parent: `DUE026` and `DUE033` (no frontmatter in its `INDEX.md`) in work, `DUE029` in the backlog, `DUE002` and `DUE009` archived.

## tickets

- `tickets/01_overview`: default view on the shared tree. Groups list their work and backlog tickets. DUEX04 has only backlog tickets, DUEX06 and DUEA01 have none, and DUEX05 is itself in the backlog, so it shows counts without a list. Also covers Unsorted and the archive summary. Starts from `lab`.
- `tickets/02_unsorted_only_in_backlog`: the only parentless ticket is in the backlog, and Unsorted still appears. Own `before/`.
- `tickets/03_empty_business`: no tickets yet; the business is looked up by name instead of code. Starts from `empty`.
- `tickets/04_parent_not_found`: a ticket references a parent that doesn't exist, so its group is marked "not found". Own `before/`.
- `tickets/05_closed_program_with_open_ticket`: a closed program still has a ticket in work, so its group is marked "archive". Own `before/`.
- `tickets/06_shelf_backlog`: `shelf="backlog"` lists every backlog ticket by parent. Starts from `lab`.
- `tickets/07_shelf_archive`: `shelf="archive"` lists every archived ticket by parent, with close dates. Starts from `lab`.
- `tickets/08_parent`: `parent` shows one program and all of its tickets, including archived ones. Starts from `lab`.
- `tickets/09_parent_unsorted`: `parent="unsorted"` lists every ticket with no parent. Starts from `lab`.
- `tickets/10_number`: `number` shows one ticket's location and frontmatter. Starts from `lab`.
- `tickets/11_number_closed_twice`: a ticket closed twice shows all of its close and reopen dates. Starts from `lab`.
- `tickets/12_error_unknown_code`: error when no business has the ticket code. Starts from `empty`.
- `tickets/13_error_no_business`: error when neither a code nor a business is given. Starts from `empty`.
- `tickets/14_error_ticket_not_found`: error when the ticket number doesn't exist. Starts from `lab`.
- `tickets/15_error_bad_shelf`: error on an unknown `shelf` value. Starts from `empty`.
- `tickets/16_number_list`: `number` given as a list returns one section per ticket. A number that doesn't exist gets an error section without failing the others, and the first line says how many resolved. Starts from `lab`.
- `tickets/17_number_program`: `number` for a program shows its frontmatter and every ticket under it, on all shelves; an empty field reads `none`. Starts from `lab`.
- `tickets/18_parent_and_shelf`: `parent` and `shelf` combine: one program's backlog tickets, with the group's full counts above. Starts from `lab`.
- `tickets/19_unsorted_and_shelf`: `parent="unsorted"` combines with `shelf` the same way. Starts from `lab`.
- `tickets/20_error_number_with_filters`: error when `number` is combined with `parent` or `shelf`, instead of silently ignoring them. Starts from `lab`.
- `tickets/21_error_number_wrong_code`: error when `code` contradicts the business the number belongs to. Starts from `lab`.
- `tickets/22_error_number_list_all_failed`: a list in which no number resolves is an error as a whole, with one section per number. Starts from `lab`.
- `tickets/23_number_empty_group`: a program with no tickets says `Tickets: none` rather than nothing. Starts from `lab`.
- `tickets/24_parent_not_found`: `parent` for a number that doesn't exist still lists the tickets that reference it, so they can be reassigned. Own `before/`.
- `tickets/25_number_program_without_frontmatter`: a program whose `INDEX.md` has no frontmatter still lists its tickets. Own `before/`.
- `tickets/26_unreadable_index`: a ticket whose `INDEX.md` can't be read (invalid UTF-8) is listed under Unreadable instead of being dropped or treated as having no parent. Own `before/`.
- `tickets/27_number_unreadable_index`: looking up an unreadable ticket reports that its frontmatter is unknown. Own `before/`.
- `tickets/28_number_folder_without_index`: a ticket folder with no `INDEX.md` is a valid ticket, and the lookup says so. Own `before/`.
- `tickets/29_number_lowercase`: a number in lowercase is accepted; a ticket with empty fields shows them as `none`. Starts from `lab`.
- `tickets/30_error_numbers_in_one_string`: several numbers in one comma-separated string get an error that shows the list form. Starts from `lab`.

## new_ticket

- `new_ticket/01_project_under_program`: a project under a program. The number is one past the highest, DUE036, which is in the archive. The business area is inherited from the parent. Starts from `lab`.
- `new_ticket/02_name_in_plain_words`: a plain-words name with no parent becomes a PascalCase folder with `parent: null`. Starts from `lab`.
- `new_ticket/03_into_backlog_with_description`: created directly in the backlog, with a description. Starts from `lab`.
- `new_ticket/04_program`: a program gets the next DUEX number, plus an icon and a business area. Starts from `lab`.
- `new_ticket/05_process`: a process gets the next DUEA number; the business is looked up by name. Starts from `lab`.
- `new_ticket/06_number_in_grouped_folders`: the highest number is in a year/month archive and another ticket is in a backlog grouping folder; both are counted, and gaps aren't reused. Own `before/`.
- `new_ticket/07_first_ticket_cyrillic_name`: the first ticket of a business, with a Cyrillic name. Non-Latin letters are kept in the folder name, and `work/` is created on demand. Starts from `empty`.
- `new_ticket/08_error_parent_is_project`: error when the parent is a project. Starts from `lab`.
- `new_ticket/09_error_parent_not_found`: error when the parent doesn't exist; the message lists the available parents. Starts from `lab`.
- `new_ticket/10_error_program_with_parent`: error when a program is given a parent. Starts from `lab`.
- `new_ticket/11_error_parent_closed`: error when the parent is closed. Starts from `lab`.
- `new_ticket/12_error_empty_name`: error when the name has no letters or digits. Starts from `empty`.
- `new_ticket/13_error_no_business`: error when no parent, code, or business is given. Starts from `empty`.
- `new_ticket/14_error_area_against_parent`: error when `area` conflicts with the parent's business area. Starts from `lab`.
- `new_ticket/15_description_line_breaks`: line breaks in a description, including U+2028, become spaces, so the text can't spill into another frontmatter field. Starts from `lab`.
- `new_ticket/16_error_description_too_long`: error when the description is over 300 characters. Starts from `lab`.
- `new_ticket/17_no_name`: an empty name creates a ticket with just its number, as the extension's new-ticket button allows. Starts from `lab`.

## move_ticket

- `move_ticket/01_to_backlog`: work to backlog. No date is recorded and the file is unchanged. Starts from `lab`.
- `move_ticket/02_back_to_work`: backlog to work. No date is recorded. Starts from `lab`.
- `move_ticket/03_close`: closing adds a `closed` date and moves the folder into the current month's archive; the body below the frontmatter is untouched. Starts from `lab`.
- `move_ticket/04_close_second_time`: closing again turns `closed` into a list and keeps the earlier date. Starts from `lab`.
- `move_ticket/05_reopen`: archive to work adds a `reopened` date and keeps `closed`. Starts from `lab`.
- `move_ticket/06_reopen_second_time`: reopening again turns `reopened` into a list. Starts from `lab`.
- `move_ticket/07_reopen_into_backlog`: archive to backlog also counts as reopening. Starts from `lab`.
- `move_ticket/08_close_in_new_month`: closing in a month that has no archive folder yet creates it. Starts from `lab`.
- `move_ticket/09_close_year_month_archive`: an archive organized as year/month keeps that layout. Own `before/`.
- `move_ticket/10_close_program`: closing a program that has no open tickets. Starts from `lab`.
- `move_ticket/11_close_without_frontmatter`: closing a ticket whose `INDEX.md` has no frontmatter adds one and keeps the body. Starts from `lab`.
- `move_ticket/12_already_there`: moving a ticket to the shelf it's already on succeeds with "No changes" and records no date, so a retry is safe. Starts from `lab`.
- `move_ticket/13_error_program_with_open_tickets`: error when closing a program that still has open tickets. Starts from `lab`.
- `move_ticket/14_error_not_found`: error when the ticket number doesn't exist. Starts from `lab`.
- `move_ticket/15_error_bad_place`: error on an unknown destination. Starts from `lab`.
- `move_ticket/16_error_two_folders`: error when two folders share a ticket number. The message asks for a human decision instead of suggesting a fix the tools can't perform. Own `before/`.
- `move_ticket/17_error_unreadable_index`: error when the ticket's `INDEX.md` can't be read; the file is never overwritten. Own `before/`.
- `move_ticket/18_error_close_program_unreadable_ticket`: error when closing a program while another open ticket is unreadable, because it might belong to that program. Own `before/`.
- `move_ticket/19_program_to_backlog`: moving a program moves only the program; the response says its tickets stay put. Starts from `lab`.
- `move_ticket/20_close_folder_without_index`: closing a ticket that has no `INDEX.md` creates one and says so. Own `before/`.
- `move_ticket/21_reopen_under_closed_parent`: reopening a ticket whose parent is closed works, with a note about the parent. Starts from `lab`.

## edit_ticket

- `edit_ticket/01_rename`: renaming changes the folder name and records the old name and the date in the frontmatter; the title heading in the body gets the new name, and the rest of the body is untouched. The response says what the name became. Starts from `lab`.
- `edit_ticket/02_rename_second_time`: renaming again turns `renamed-from` and `renamed` into lists. Starts from `lab`.
- `edit_ticket/03_rename_letter_case_only`: a case-only rename (UIResearch to UiResearch) works on a case-insensitive filesystem instead of failing with "already exists". Starts from `lab`.
- `edit_ticket/04_parent_changed`: a new parent updates the business area to match; each change line names the previous value. Starts from `lab`.
- `edit_ticket/05_parent_given_to_unsorted`: giving a parentless ticket a parent fills in its empty business area. Starts from `lab`.
- `edit_ticket/06_parent_removed`: removing the parent sets `parent: null` and keeps the business area. Starts from `lab`.
- `edit_ticket/07_description_set`: setting a description. Starts from `lab`.
- `edit_ticket/08_description_removed_icon_set`: removing the description and setting an icon in one call. Starts from `lab`.
- `edit_ticket/09_everything_at_once`: changing the name, parent, and description in one call. Starts from `lab`.
- `edit_ticket/10_closed_ticket`: editing an archived ticket leaves it in the archive. Starts from `lab`.
- `edit_ticket/11_error_parent_is_project`: error when the new parent is a project. Starts from `lab`.
- `edit_ticket/12_error_program_gets_parent`: error when a program is given a parent. Starts from `lab`.
- `edit_ticket/13_error_nothing_given`: error when no field to change is given; the message explains that an empty string clears a field and null leaves it unchanged. Starts from `lab`.
- `edit_ticket/14_already_up_to_date`: a ticket that already has the given values succeeds with "No changes", so a retry is safe. Starts from `lab`.
- `edit_ticket/15_error_unreadable_index`: error when the ticket's `INDEX.md` can't be read; the file is never overwritten. Own `before/`.
- `edit_ticket/16_area_set`: setting the business area of a ticket with no parent. Starts from `lab`.
- `edit_ticket/17_parent_removed_area_changed`: clearing the parent and setting a new business area in one call. Starts from `lab`.
- `edit_ticket/18_error_area_against_parent`: error when `area` conflicts with the business area inherited from the parent. Starts from `lab`.
- `edit_ticket/20_crlf_line_endings`: a file with Windows (CRLF) line endings keeps them, in the frontmatter and in the body. Own `before/`.
- `edit_ticket/22_rename_keeps_unrelated_heading`: a title heading that doesn't mention the old name is left alone, and the response says so. Own `before/`.
- `edit_ticket/21_error_empty_name`: error when `name` is an empty string; a name can be changed but not cleared. Starts from `lab`.
- `edit_ticket/19_error_null_string_is_not_a_parent`: the string "none" is not a way to clear the parent; the error says to pass an empty string. Starts from `lab`.
