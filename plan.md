# Project Plan: GB Fantasy

## What We Are Building
A professional Premier League prediction platform with:
- 10-match gameweek fixtures
- Player prediction submission (1X2 + correct scores)
- Automated scoring system
- Tournament management with cash prizes
- Live leaderboards
- Player registration and profiles

## Tech Stack
- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Styling:** Modern CSS Grid/Flexbox, responsive design
- **Theme:** Dark professional (OLBG-inspired)
- **Data:** Static JSON for fixtures (API integration ready)
- **Icons:** Font Awesome

## Pages Required

### 1. Home/Landing Page
| Task | Agent | Description |
|------|-------|-------------|
| 1.1 | qwen2.5-coder:7b | Hero section with current GW highlights |
| 1.2 | qwen2.5-coder:7b | Live tournament status cards |
| 1.3 | qwen2.5-coder:7b | Quick navigation to predictions/leaderboard |

### 2. Predictions Page
| Task | Agent | Description |
|------|-------|-------------|
| 2.1 | qwen2.5-coder:7b | 10-match fixture display (home/away teams, kickoff times) |
| 2.2 | qwen2.5-coder:7b | Prediction form: 1X2 selection per match |
| 2.3 | qwen2.5-coder:7b | Score prediction input (optional bonus) |
| 2.4 | qwen2.5-coder:7b | Submit/save predictions functionality |
| 2.5 | qwen2.5-coder:7b | Gameweek selector (GW1-38) |

### 3. Leaderboard Page
| Task | Agent | Description |
|------|-------|-------------|
| 3.1 | qwen2.5-coder:7b | Rankings table with player names |
| 3.2 | qwen2.5-coder:7b | Points display (GW + total) |
| 3.3 | qwen2.5-coder:7b | Tournament-specific leaderboards |
| 3.4 | qwen2.5-coder:7b | Prize position indicators (1st, 2nd, 3rd) |

### 4. Tournaments Page
| Task | Agent | Description |
|------|-------|-------------|
| 4.1 | qwen2.5-coder:7b | Active tournaments list |
| 4.2 | qwen2.5-coder:7b | Entry fee and prize pot display |
| 4.3 | qwen2.5-coder:7b | Player count and status |
| 4.4 | qwen2.5-coder:7b | Join tournament button/form |

### 5. Player Registration
| Task | Agent | Description |
|------|-------|-------------|
| 5.1 | qwen2.5-coder:7b | Username registration form |
| 5.2 | qwen2.5-coder:7b | New player onboarding flow |

### 6. Styling & Theme
| Task | Agent | Description |
|------|-------|-------------|
| 6.1 | qwen2.5-coder:7b | OLBG-inspired dark theme (navy/dark blue) |
| 6.2 | qwen2.5-coder:7b | Responsive mobile layout |
| 6.3 | qwen2.5-coder:7b | Professional typography and spacing |
| 6.4 | qwen2.5-coder:7b | Card-based component design |

### 7. JavaScript Functionality
| Task | Agent | Description |
|------|-------|-------------|
| 7.1 | qwen2.5-coder:7b | Tab/page navigation |
| 7.2 | qwen2.5-coder:7b | Prediction form validation |
| 7.3 | qwen2.5-coder:7b | Local storage for predictions |
| 7.4 | qwen2.5-coder:7b | Dynamic content loading |

## Agent Assignments
| Agent | Role |
|-------|------|
| qwen2.5-coder:7b | All HTML, CSS, JavaScript development |
| qwen3:14b | Complex architecture decisions if needed |
| gemma | Content writing, documentation |
| phi3 | Quick utility scripts |

## Scoring System (for reference)
- Correct result (1X2): 10 points
- Correct score bonus: +10 points (20 total)
- Maximum per GW: 200 points (10 matches × 20 points)

## File Structure
```
frontend/
├── index.html              # Home/landing
├── predictions.html        # GW predictions page
├── leaderboard.html        # Rankings
├── tournaments.html        # Tournament list
├── register.html           # Player registration
├── css/
│   └── style.css           # Main stylesheet
├── js/
│   └── app.js              # Main JavaScript
├── data/
│   └── fixtures.json       # PL fixtures (10 per GW)
└── assets/
    └── images/             # Team logos, icons
```

## Success Criteria
- [ ] All 5 pages functional and linked
- [ ] 10-match GW prediction form working
- [ ] Dark professional theme matching OLBG quality
- [ ] Responsive on mobile and desktop
- [ ] Tournament and leaderboard displays
- [ ] Player registration flow
