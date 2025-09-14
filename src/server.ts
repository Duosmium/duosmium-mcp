#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import Fuse from 'fuse.js';

const sciolyff = require('sciolyff');
type Tournament = any; // Tournament type from sciolyff

// Load environment variables from .env file
dotenv.config();

const DUOSMIUM_PATH = process.env.DUOSMIUM_PATH;
const PORT = process.env.PORT || 3000;

if (!DUOSMIUM_PATH) {
  console.error('Error: DUOSMIUM_PATH environment variable is not set');
  console.error('Please set it in your environment or create a .env file with:');
  console.error('DUOSMIUM_PATH=/path/to/duosmium');
  process.exit(1);
}

function tournamentTitle(tInfo: Tournament) {
	const expandStateName = (state: string) => {
		return state.replace('sCA', 'SoCal').replace('nCA', 'NorCal');
	};
	if (tInfo.name) return tInfo.name;

	switch (tInfo.level) {
		case 'Nationals':
			return 'Science Olympiad National Tournament';
		case 'States':
			return `${expandStateName(tInfo.state)} Science Olympiad State Tournament`;
		case 'Regionals':
			return `${tInfo.location} Regional Tournament`;
		case 'Invitational':
			return `${tInfo.location} Invitational`;
	}
}

class DuosmiumMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'duosmium-mcp',
        version: '0.0.1',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }



  private async getAvailableTournaments(): Promise<string[]> {
    try {
      const resultsPath = path.join(DUOSMIUM_PATH!, 'data', 'results');
      const files = await fs.readdir(resultsPath);
      
      // Filter for .yaml files and remove the extension to get tournament IDs
      return files
        .filter(file => file.endsWith('.yaml'))
        .map(file => file.slice(0, -5)) // Remove .yaml extension
        .sort();
    } catch (error) {
      console.error('Error reading tournaments directory:', error);
      return [];
    }
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      // Get available tournaments for autocomplete
      const availableTournaments = await this.getAvailableTournaments();
      
      const resources = [
        {
          uri: 'duosmium://results/{id}',
          name: 'Science Olympiad Results',
          description: 'Access Science Olympiad results by ID. Replace {id} with the specific result identifier.',
          mimeType: 'application/x-yaml',
        }
      ];

      // Add individual tournament resources for autocomplete
      availableTournaments.forEach(tournamentId => {
        resources.push({
          uri: `duosmium://results/${tournamentId}`,
          name: `Science Olympiad Results - ${tournamentId}`,
          description: `Results for tournament: ${tournamentId}`,
          mimeType: 'application/x-yaml',
        });
      });

      return { resources };
    });

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_team_placement',
            description: 'Get a team\'s placement in a specific event or overall tournament ranking using sciolyff Interpreter for accurate results. If no event is specified, returns overall placement.',
            inputSchema: {
              type: 'object',
              properties: {
                tournamentId: {
                  type: 'string',
                  description: 'Tournament ID (e.g., "1989-03-10_sCA_orange_county_regional_b")',
                },
                teamId: {
                  type: 'string', 
                  description: 'Team identifier (school name or team number)',
                },
                event: {
                  type: 'string',
                  description: 'Event name (e.g., "Bridge Building", "Mystery Substance"). If omitted, returns overall tournament placement.',
                },
              },
              required: ['tournamentId', 'teamId'],
            },
          },
          {
            name: 'get_tournament_rankings',
            description: 'Get complete tournament rankings with accurate placement calculations using sciolyff Interpreter',
            inputSchema: {
              type: 'object',
              properties: {
                tournamentId: {
                  type: 'string',
                  description: 'Tournament ID (e.g., "1989-03-10_sCA_orange_county_regional_b")',
                },
                limit: {
                  type: 'number',
                  description: 'Optional limit on number of teams to return (default: all teams)',
                },
              },
              required: ['tournamentId'],
            },
          },
          {
            name: 'list_tournaments',
            description: 'List all available tournaments for autocomplete and discovery',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          },
          {
            name: 'get_tournament_info',
            description: 'Get tournament information including teams and events for autocomplete',
            inputSchema: {
              type: 'object',
              properties: {
                tournamentId: {
                  type: 'string',
                  description: 'Tournament ID (e.g., "1989-03-10_sCA_orange_county_regional_b")',
                },
              },
              required: ['tournamentId'],
            },
          },
          {
            name: 'get_tournament_teams',
            description: 'Get detailed list of all teams in a tournament with numbers, names, locations, and suffixes',
            inputSchema: {
              type: 'object',
              properties: {
                tournamentId: {
                  type: 'string',
                  description: 'Tournament ID (e.g., "1989-03-10_sCA_orange_county_regional_b")',
                },
              },
              required: ['tournamentId'],
            },
          },
          {
            name: 'get_team_all_placements',
            description: 'Get all event placements for a specific team in a tournament using sciolyff Interpreter',
            inputSchema: {
              type: 'object',
              properties: {
                tournamentId: {
                  type: 'string',
                  description: 'Tournament ID (e.g., "1989-03-10_sCA_orange_county_regional_b")',
                },
                teamId: {
                  type: 'string', 
                  description: 'Team identifier (school name or team number)',
                },
              },
              required: ['tournamentId', 'teamId'],
            },
          },
          {
            name: 'search',
            description: 'Search tournaments and schools from duosmium.org remote data sources',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query (e.g., tournament name, school name, location)',
                },
                type: {
                  type: 'string',
                  enum: ['tournament', 'school', 'all'],
                  description: 'Type of search: tournament, school, or all (default: all)',
                  default: 'all',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 20)',
                  default: 20,
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'fetch',
            description: 'Retrieve Duosmium data and return the contents as JSON',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Tournament Duosmium ID',
                },
              },
              required: ['id'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      // Helper function to load and create Interpreter
      const loadInterpreter = async (tournamentId: string) => {
        const filePath = path.join(DUOSMIUM_PATH!, 'data', 'results', `${tournamentId}.yaml`);
        const content = await fs.readFile(filePath, 'utf-8');
        const data = yaml.load(content) as any;
        return new sciolyff.default.Interpreter(data);
      };

      // Helper function to find team
      const findTeam = (interpreter: any, teamId: string) => {
        return interpreter.teams.find((t: any) => 
          t.number.toString() === teamId || 
          t.school?.toLowerCase().includes(teamId.toLowerCase())
        );
      };
      
      if (name === 'get_team_placement') {
        const { tournamentId, teamId, event } = args as {
          tournamentId: string;
          teamId: string; 
          event?: string;
        };

        try {
          const interpreter = await loadInterpreter(tournamentId);
          const team = findTeam(interpreter, teamId);

          if (!team) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Team "${teamId}" not found in tournament "${tournamentId}"`,
                },
              ],
            };
          }

          // If no event specified, return overall placement
          if (!event) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Team: ${team.school} (#${team.number})\nOverall Rank: ${team.rank}\nTotal Points: ${team.points}\nTournament: ${interpreter.tournament.name || tournamentId}\nDisqualified: ${team.disqualified ? 'Yes' : 'No'}\nExhibition: ${team.exhibition ? 'Yes' : 'No'}`,
                },
              ],
            };
          }

          // Find placement for this team and event using interpreter
          const placement = interpreter.placings.find((p: any) => 
            p.team.number === team.number && p.event.name === event
          );

          if (!placement) {
            return {
              content: [
                {
                  type: 'text',
                  text: `No placement found for team "${team.school}" (#${team.number}) in event "${event}"`,
                },
              ],
            };
          }

          const tieText = placement.tie ? ' (tie)' : '';
          const placeText = placement.place === 0 ? 'DQ/NS' : (placement.place?.toString() || 'N/A');
          const points = placement.points || 'N/A';

          return {
            content: [
              {
                type: 'text',
                text: `Team: ${team.school} (#${team.number})\nEvent: ${event}\nPlacement: ${placeText}${tieText}\nPoints: ${points}\nTournament: ${interpreter.tournament.name || tournamentId}`,
              },
            ],
          };
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            return {
              content: [
                {
                  type: 'text',
                  text: `Tournament "${tournamentId}" not found`,
                },
              ],
            };
          }
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to get team placement: ${error.message}`
          );
        }
      }

      if (name === 'get_tournament_rankings') {
        const { tournamentId, limit } = args as {
          tournamentId: string;
          limit?: number;
        };

        try {
          const interpreter = await loadInterpreter(tournamentId);
          let teams = interpreter.teams.slice(); // Copy array
          
          if (limit && limit > 0) {
            teams = teams.slice(0, limit);
          }

          const rankings = teams.map((team: any, index: number) => {
            const status = [];
            if (team.disqualified) status.push('DQ');
            if (team.exhibition) status.push('Exhibition');
            const statusText = status.length > 0 ? ` (${status.join(', ')})` : '';
            
            return `${team.rank}. ${team.school} (#${team.number}) - ${team.points} points${statusText}`;
          }).join('\n');

          return {
            content: [
              {
                type: 'text',
                text: `Tournament: ${interpreter.tournament.name || tournamentId}\nTotal Teams: ${interpreter.teams.length}\n\nRankings:\n${rankings}`,
              },
            ],
          };
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            return {
              content: [
                {
                  type: 'text',
                  text: `Tournament "${tournamentId}" not found`,
                },
              ],
            };
          }
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to get tournament rankings: ${error.message}`
          );
        }
      }

      if (name === 'list_tournaments') {
        try {
          const tournaments = await this.getAvailableTournaments();
          
          return {
            content: [
              {
                type: 'text',
                text: `Available Tournaments (${tournaments.length}):\n${tournaments.join('\n')}`,
              },
            ],
          };
        } catch (error: any) {
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to list tournaments: ${error.message}`
          );
        }
      }

      if (name === 'get_tournament_info') {
        const { tournamentId } = args as {
          tournamentId: string;
        };

        try {
          const interpreter = await loadInterpreter(tournamentId);
          
          const teams = interpreter.teams.map((team: any) => 
            `${team.school} (#${team.number})`
          );
          
          const events = interpreter.events.map((event: any) => 
            event.name
          );

          return {
            content: [
              {
                type: 'text',
                text: `Tournament: ${interpreter.tournament.name || tournamentId}\n\nTeams (${teams.length}):\n${teams.join('\n')}\n\nEvents (${events.length}):\n${events.join('\n')}`,
              },
            ],
          };
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            return {
              content: [
                {
                  type: 'text',
                  text: `Tournament "${tournamentId}" not found`,
                },
              ],
            };
          }
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to get tournament info: ${error.message}`
          );
        }
      }

      if (name === 'get_tournament_teams') {
        const { tournamentId } = args as {
          tournamentId: string;
        };

        try {
          const interpreter = await loadInterpreter(tournamentId);
          
          const teamDetails = interpreter.teams.map((team: any) => {
            const parts = [];
            parts.push(`#${team.number}`);
            parts.push(team.school);
            
            if (team.location) parts.push(`(${team.location})`);
            if (team.suffix) parts.push(`- ${team.suffix}`);
            
            const status = [];
            if (team.disqualified) status.push('DQ');
            if (team.exhibition) status.push('Exhibition');
            if (status.length > 0) parts.push(`[${status.join(', ')}]`);
            
            return parts.join(' ');
          });

          return {
            content: [
              {
                type: 'text',
                text: `Tournament: ${interpreter.tournament.name || tournamentId}\nTotal Teams: ${interpreter.teams.length}\n\nTeams:\n${teamDetails.join('\n')}`,
              },
            ],
          };
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            return {
              content: [
                {
                  type: 'text',
                  text: `Tournament "${tournamentId}" not found`,
                },
              ],
            };
          }
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to get tournament teams: ${error.message}`
          );
        }
      }

      if (name === 'get_team_all_placements') {
        const { tournamentId, teamId } = args as {
          tournamentId: string;
          teamId: string;
        };

        try {
          const interpreter = await loadInterpreter(tournamentId);
          const team = findTeam(interpreter, teamId);

          if (!team) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Team "${teamId}" not found in tournament "${tournamentId}"`,
                },
              ],
            };
          }

          // Get all placements for this team
          const teamPlacements = interpreter.placings.filter((p: any) => 
            p.team.number === team.number
          );

          if (teamPlacements.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: `No placements found for team "${team.school}" (#${team.number})`,
                },
              ],
            };
          }

          const placementDetails = teamPlacements.map((placement: any) => {
            const tieText = placement.tie ? ' (tie)' : '';
            const placeText = placement.place === 0 ? 'DQ/NS' : (placement.place?.toString() || 'N/A');
            const points = placement.points || 'N/A';
            const dropped = placement.dropped ? ' [DROPPED]' : '';
            
            return `${placement.event.name}: ${placeText}${tieText} (${points} points)${dropped}`;
          });

          const teamInfo = [];
          if (team.location) teamInfo.push(team.location);
          if (team.suffix) teamInfo.push(team.suffix);
          const teamInfoText = teamInfo.length > 0 ? ` (${teamInfo.join(', ')})` : '';

          const status = [];
          if (team.disqualified) status.push('Disqualified');
          if (team.exhibition) status.push('Exhibition');
          const statusText = status.length > 0 ? `\nStatus: ${status.join(', ')}` : '';

          return {
            content: [
              {
                type: 'text',
                text: `Team: ${team.school} (#${team.number})${teamInfoText}\nOverall Rank: ${team.rank}\nTotal Points: ${team.points}${statusText}\nTournament: ${interpreter.tournament.name || tournamentId}\n\nEvent Placements (${placementDetails.length}):\n${placementDetails.join('\n')}`,
              },
            ],
          };
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            return {
              content: [
                {
                  type: 'text',
                  text: `Tournament "${tournamentId}" not found`,
                },
              ],
            };
          }
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to get team all placements: ${error.message}`
          );
        }
      }

      if (name === 'search') {
        const { query, type = 'all', limit = 20 } = args as {
          query: string;
          type?: 'tournament' | 'school' | 'all';
          limit?: number;
        };

        try {
          // Normalize query - treat "team" as "school"
          const normalizedQuery = query.toLowerCase().replace(/\bteam\b/g, 'school');
          
          // Fetch both remote data sources
          const [tournamentsResponse, schoolsResponse] = await Promise.all([
            fetch('https://duosmium.org/results/tournaments.json'),
            fetch('https://duosmium.org/results/schools.csv')
          ]);
          
          if (!tournamentsResponse.ok) {
            throw new Error(`Failed to fetch tournaments: ${tournamentsResponse.status}`);
          }
          
          if (!schoolsResponse.ok) {
            throw new Error(`Failed to fetch schools: ${schoolsResponse.status}`);
          }
          
          const tournaments = await tournamentsResponse.json();
          const schoolsCsvText = await schoolsResponse.text();
          
          // Build search data arrays
          const searchData: Array<{
            type: 'tournament' | 'school';
            name: string;
            id: string;
            details: string;
            searchText: string;
            metadata?: any;
          }> = [];
          
          // Process tournaments data
          if (type === 'tournament' || type === 'all') {
            tournaments.forEach((tournament: any) => {
              const name = tournament.title || tournament.filename || 'Unknown Tournament';
              const location = tournament.location || '';
              const division = tournament.division || '';
              const year = tournament.year || '';
              const official = tournament.official ? 'Official' : 'Unofficial';
              const keywords = tournament.keywords || '';
              
              searchData.push({
                type: 'tournament',
                name,
                id: tournament.filename,
                details: `${division} Division • ${year} • ${location} • ${official}`,
                searchText: `${name} ${location} ${division} ${year} ${tournament.filename} ${keywords}`.toLowerCase(),
                metadata: {
                  bgColor: tournament.bgColor,
                  teamCount: tournament.teamCount,
                  date: tournament.date,
                  logo: tournament.logo,
                  events: tournament.events,
                  keywords
                }
              });
            });
          }
          
          // Process schools CSV data
          if (type === 'school' || type === 'all') {
            const schoolLines = schoolsCsvText.split('\n').filter(line => line.trim());
            
            schoolLines.forEach((line, index) => {
              const parts = line.split(',').map(part => part.replace(/^"(.*)"$/, '$1').trim());
              const schoolName = parts[0];
              const city = parts[1] || '';
              const state = parts[2] || '';
              
              if (schoolName) {
                const locationParts = [city, state].filter(Boolean);
                const locationStr = locationParts.join(', ');
                
                searchData.push({
                  type: 'school',
                  name: schoolName,
                  id: `school-${index}`,
                  details: locationStr || 'Location not specified',
                  searchText: `${schoolName} ${city} ${state} team`.toLowerCase(),
                  metadata: { city, state }
                });
              }
            });
          }
          
          // Perform fuzzy search using Fuse.js
          const fuse = new Fuse(searchData, {
            keys: [
              { name: 'name', weight: 0.7 },
              { name: 'searchText', weight: 0.3 }
            ],
            threshold: 0.3,
            distance: 200,
            includeScore: true,
            ignoreLocation: true
          });
          
          const searchResults = fuse.search(normalizedQuery).slice(0, limit);
          
          if (searchResults.length === 0) {
            const searchTypeText = type === 'all' ? 'tournaments or schools' : `${type}s`;
            return {
              content: [{
                type: 'text',
                text: `No ${searchTypeText} found matching "${query}"`
              }]
            };
          }
          
          // Format results
          const formattedResults = searchResults.map(result => {
            const item = result.item;
            const score = result.score ? ` (${(result.score * 100).toFixed(1)}% match)` : '';
            return `${item.type.toUpperCase()}: ${item.name}\n  ${item.details}${score}\n  ID: ${item.id}`;
          }).join('\n\n');
          
          const summary = `Found ${searchResults.length} result${searchResults.length === 1 ? '' : 's'} for "${query}"`;
          const typeBreakdown = searchResults.reduce((acc, result) => {
            acc[result.item.type] = (acc[result.item.type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          const breakdown = Object.entries(typeBreakdown)
            .map(([type, count]) => `${count} ${type}${count === 1 ? '' : 's'}`)
            .join(', ');
          
          return {
            content: [{
              type: 'text',
              text: `${summary} (${breakdown}):\n\n${formattedResults}`
            }]
          };
          
        } catch (error: any) {
          throw new McpError(
            ErrorCode.InternalError,
            `Search failed: ${error.message}`
          );
        }
      }

      if (name === 'fetch') {
        const { id } = args as {
          id: string;
        };

        try {
          const filePath = path.join(DUOSMIUM_PATH!, 'data', 'results', `${id}.yaml`);
          
          const content = await fs.readFile(filePath, 'utf-8');
          const data = yaml.load(content);
          
          // Create interpreter and get tournament title
          const interpreter = new sciolyff.default.Interpreter(data);
          const title = tournamentTitle(interpreter.tournament);
          // Convert to JSON and return
          const tournamentJson = JSON.stringify({
            id: id,
            title: title,
            text: data,
            url: `https://www.duosmium.org/results/${id}`
          }, null, 2);
          
          return {
            content: [{ type: "text", text: tournamentJson }],
          };
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            return {
              content: [
                {
                  type: 'text',
                  text: `Tournament "${id}" not found`,
                },
              ],
            };
          }
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to fetch tournament data: ${error.message}`
          );
        }
      }

      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      
      if (!uri.startsWith('duosmium://results/')) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Invalid URI scheme. Expected duosmium://results/{id}`
        );
      }

      const id = uri.replace('duosmium://results/', '');
      const filePath = path.join(DUOSMIUM_PATH!, 'data', 'results', `${id}.yaml`);

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const parsedYaml = yaml.load(content);
        
        return {
          contents: [
            {
              uri,
              mimeType: 'application/x-yaml',
              text: content,
            },
          ],
        };
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Resource not found: ${id}`
          );
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to read resource: ${error.message}`
        );
      }
    });
  }

  async start() {
    const app = express();
    
    // Enable CORS
    app.use(cors());
    
    // Parse JSON bodies
    app.use(express.json());
    
    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', service: 'duosmium-mcp' });
    });
    
    // MCP endpoint - handle both GET and POST
    app.all('/mcp', async (req, res) => {
      // Create stateless StreamableHTTPServerTransport for each request
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode
        enableJsonResponse: true, // Enable JSON responses for simple request/response
      });
      
      // Connect the transport to the server
      await this.server.connect(transport);
      
      try {
        // The transport will handle both GET (SSE) and POST requests
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });
    
    app.listen(PORT, () => {
      console.log(`Duosmium MCP server running on http://localhost:${PORT}`);
      console.log(`MCP endpoint: http://localhost:${PORT}/mcp (GET for SSE, POST for JSON-RPC)`);
      console.log(`Health check: GET http://localhost:${PORT}/health`);
    });
  }
}

const server = new DuosmiumMCPServer();
server.start().catch(console.error);