export default {
  "about": "One store's rows, read by both suites: hooks/model.test.ts checks that the view below stores these rows and that the pane draws these lines; tests/test_account_rotator_cli.py, which parses what follows `export default` as JSON, checks that account list prints them. Times are epoch ms; the clock reads `now`, in `zone`.",
  "now": 1794156000000,
  "zone": "Europe/Tallinn",
  "view": {
    "activeId": "1",
    "accounts": [
      { "id": "1", "slot": "", "email": "andres@lutsohealth.com", "orgName": "Company", "plan": "max", "tier": "default_claude_max_20x" },
      { "id": "2", "slot": "/home/test/.claude/accounts/2", "email": "two@example.com", "orgName": "two@example.com's Organization", "plan": "max", "tier": "default_claude_max_5x" }
    ],
    "health": { "1": { "kind": "ok" }, "2": { "kind": "ok" } },
    "readings": {
      "1": { "sevenDay": { "pct": 31, "resetsAt": "2026-11-10T19:54:00Z" }, "fable": { "pct": 38, "resetsAt": "2026-11-09T19:54:00Z" }, "noFiveHour": true, "at": 1794155640000, "by": "1" },
      "2": { "sevenDay": { "pct": 60, "resetsAt": "2026-11-13T16:40:00Z" }, "fable": { "pct": 10, "resetsAt": "2026-11-13T16:40:00Z" }, "fiveHour": { "pct": 50, "resetsAt": "2026-11-08T18:00:30Z" }, "at": 1794153840000, "by": "2" }
    },
    "noFiveHour": { "1": true, "2": false },
    "readAt": { "1": 1794155640000, "2": 1794153840000 },
    "checkErrors": { "2": { "why": "the usage call answered HTTP 429 (retry after 60 s)", "at": 1794155940000 } }
  },
  "store": {
    "accounts": [
      { "id": "1", "slot": "", "email": "andres@lutsohealth.com", "orgName": "Company", "plan": "max", "tier": "default_claude_max_20x" },
      { "id": "2", "slot": "/home/test/.claude/accounts/2", "email": "two@example.com", "orgName": "two@example.com's Organization", "plan": "max", "tier": "default_claude_max_5x" }
    ],
    "health:1": { "kind": "ok" },
    "health:2": { "kind": "ok" },
    "launch-on": "room",
    "launch-slot": { "id": "1", "slot": "", "why": "the most room", "at": 1794155700000 },
    "rows": {
      "v": 1,
      "at": 1794156000000,
      "rows": [
        {
          "id": "1",
          "lines": [
            ["andres@lutsohealth.com · Company · Ultra  updated ", { "clock": 1794155640000 }],
            ["Used ▰▰▰▱▱▱▱▱▱▱ 31% Fable ▰▰▰▰▱▱▱▱▱▱ 38%  resets ", { "until": 1794340440000 }, " · Fable ", { "until": 1794254040000 }]
          ]
        },
        {
          "id": "2",
          "lines": [
            ["two@example.com · Max  ", { "clock": 1794155940000 }, " Failed to update (HTTP 429)"],
            ["Used ▰▰▰▰▰▰▱▱▱▱ 60% Fable ▰▱▱▱▱▱▱▱▱▱ 10%  resets ", { "until": 1794588000000 }],
            ["5h ▰▰▰▰▰▱▱▱▱▱ 50%  resets ", { "until": 1794160830000 }]
          ]
        }
      ]
    }
  },
  "lines": {
    "1": [
      "andres@lutsohealth.com · Company · Ultra  updated 18:34",
      "Used ▰▰▰▱▱▱▱▱▱▱ 31% Fable ▰▰▰▰▱▱▱▱▱▱ 38%  resets 2d 3h 14m · Fable 1d 3h 14m"
    ],
    "2": [
      "two@example.com · Max  18:39 Failed to update (HTTP 429)",
      "Used ▰▰▰▰▰▰▱▱▱▱ 60% Fable ▰▱▱▱▱▱▱▱▱▱ 10%  resets 5d 0h 0m",
      "5h ▰▰▰▰▰▱▱▱▱▱ 50%  resets 1h 21m"
    ]
  }
}
