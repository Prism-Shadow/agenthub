> Source: https://ai.google.dev/gemini-api/docs/function-calling (snapshot 2026-09-16)
>
> Java samples removed.

Function calling lets you connect models to external tools and APIs.
Instead of generating text responses, the model determines when to call specific
functions and provides the necessary parameters to execute real-world actions.
This allows the model to act as a bridge between natural language and real-world
actions and data. Function calling has 3 primary use cases:

- [**Take Actions:**](https://ai.google.dev/gemini-api/docs/function-calling#meeting) Interact with external systems using APIs, such as scheduling appointments, creating invoices, sending emails, or controlling smart home devices.
- [**Augment Knowledge:**](https://ai.google.dev/gemini-api/docs/function-calling#weather) Access information from external sources like databases, APIs, and knowledge bases.
- [**Extend Capabilities:**](https://ai.google.dev/gemini-api/docs/function-calling#chart) Use external tools to perform computations and extend the limitations of the model, such as using a calculator or creating charts.

You can browse examples of these use cases below:

### Schedule Meeting

This example shows how to define a function that schedules a meeting with attendees at a specific time, allowing the model to parse user requests and return structured arguments to trigger actions in external systems.

### Python

    from google import genai

    schedule_meeting_function = {
        "type": "function",
        "name": "schedule_meeting",
        "description": "Schedules a meeting with specified attendees at a given time and date.",
        "parameters": {
            "type": "object",
            "properties": {
                "attendees": {"type": "array", "items": {"type": "string"}},
                "date": {"type": "string", "description": "Date (e.g., '2024-07-29')"},
                "time": {"type": "string", "description": "Time (e.g., '15:00')"},
                "topic": {"type": "string", "description": "The meeting topic."},
            },
            "required": ["attendees", "date", "time", "topic"],
        },
    }

    client = genai.Client()

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="Schedule a meeting with Bob and Alice for 03/14/2025 at 10:00 AM about Q3 planning.",
        tools=[{"type": "function", **schedule_meeting_function}],
    )

    for step in interaction.steps:
        if step.type == "function_call":
            print(f"Function to call: {step.name}")
            print(f"Arguments: {step.arguments}")

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const scheduleMeetingFunction = {
      type: 'function',
      name: 'schedule_meeting',
      description: 'Schedules a meeting with specified attendees at a given time and date.',
      parameters: {
        type: 'object',
        properties: {
          attendees: { type: 'array', items: { type: 'string' } },
          date: { type: 'string', description: 'Date (e.g., "2024-07-29")' },
          time: { type: 'string', description: 'Time (e.g., "15:00")' },
          topic: { type: 'string', description: 'The meeting topic.' },
        },
        required: ['attendees', 'date', 'time', 'topic'],
      },
    };

    const interaction = await client.interactions.create({
      model: 'gemini-3.8-flash',
      input: 'Schedule a meeting with Bob and Alice for 03/27/2025 at 10:00 AM about Q3 planning.',
      tools: [scheduleMeetingFunction],
    });

    for (const step of interaction.steps) {
      if (step.type === 'function_call') {
        console.log(`Function to call: ${step.name}`);
        console.log(`Arguments: ${JSON.stringify(step.arguments)}`);
      }
    }

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d '{
        "model": "gemini-3.8-flash",
        "input": "Schedule a meeting with Bob and Alice for 03/27/2025 at 10:00 AM about Q3 planning.",
        "tools": [{
            "type": "function",
            "name": "schedule_meeting",
            "description": "Schedules a meeting with specified attendees at a given time and date.",
            "parameters": {
              "type": "object",
              "properties": {
                "attendees": {"type": "array", "items": {"type": "string"}},
                "date": {"type": "string"},
                "time": {"type": "string"},
                "topic": {"type": "string"}
              },
              "required": ["attendees", "date", "time", "topic"]
            }
        }]
      }'

### Get Weather

This example shows how to define a function that retrieves temperature data for a location, enabling the model to call external APIs to answer queries requiring real-time or external information.

### Python

    from google import genai

    weather_function = {
        "type": "function",
        "name": "get_current_temperature",
        "description": "Gets the current temperature for a given location.",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city name, e.g. San Francisco",
                },
            },
            "required": ["location"],
        },
    }

    client = genai.Client()

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="What's the temperature in London?",
        tools=[weather_function],
    )

    for step in interaction.steps:
        if step.type == "function_call":
            print(f"Function to call: {step.name}")
            print(f"Arguments: {step.arguments}")

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const weatherFunctionDeclaration = {
      type: 'function',
      name: 'get_current_temperature',
      description: 'Gets the current temperature for a given location.',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The city name, e.g. San Francisco',
          },
        },
        required: ['location'],
      },
    };

    const interaction = await client.interactions.create({
      model: 'gemini-3.8-flash',
      input: "What's the temperature in London?",
      tools: [weatherFunctionDeclaration],
    });

    for (const step of interaction.steps) {
      if (step.type === 'function_call') {
        console.log(`Function to call: ${step.name}`);
        console.log(`Arguments: ${JSON.stringify(step.arguments)}`);
      }
    }

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d '{
        "model": "gemini-3.8-flash",
        "input": "What'\''s the temperature in London?",
        "tools": [{
          "type": "function",
          "name": "get_current_temperature",
          "description": "Gets the current temperature for a given location.",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {"type": "string", "description": "The city name"}
            },
            "required": ["location"]
          }
        }]
      }'

### Create Chart

This example shows how to define a function that generates a bar chart from structured data, demonstrating how the model can use external tools to perform computations or create visual assets:

### Python

    from google import genai

    create_chart_function = {
        "type": "function",
        "name": "create_bar_chart",
        "description": "Creates a bar chart given a title, labels, and values.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "The title for the chart."},
                "labels": {"type": "array", "items": {"type": "string"}},
                "values": {"type": "array", "items": {"type": "number"}},
            },
            "required": ["title", "labels", "values"],
        },
    }

    client = genai.Client()

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="Create a bar chart titled 'Quarterly Sales' with Q1: 50000, Q2: 75000, Q3: 60000.",
        tools=[create_chart_function],
    )

    for step in interaction.steps:
        if step.type == "function_call":
            print(f"Function to call: {step.name}")
            print(f"Arguments: {step.arguments}")

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const createChartFunctionDeclaration = {
      type: 'function',
      name: 'create_bar_chart',
      description: 'Creates a bar chart given a title, labels, and values.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The title for the chart.' },
          labels: { type: 'array', items: { type: 'string' } },
          values: { type: 'array', items: { type: 'number' } },
        },
        required: ['title', 'labels', 'values'],
      },
    };

    const interaction = await client.interactions.create({
      model: 'gemini-3.8-flash',
      input: "Create a bar chart titled 'Quarterly Sales' with Q1: 50000, Q2: 75000, Q3: 60000.",
      tools: [createChartFunctionDeclaration],
    });

    for (const step of interaction.steps) {
      if (step.type === 'function_call') {
        console.log(`${step.name}(${JSON.stringify(step.arguments)})`);
      }
    }

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d '{
        "model": "gemini-3.8-flash",
        "input": "Create a bar chart titled '\''Quarterly Sales'\'' with Q1: 50000, Q2: 75000, Q3: 60000.",
        "tools": [{
            "type": "function",
            "name": "create_bar_chart",
            "description": "Creates a bar chart given a title, labels, and values.",
            "parameters": {
              "type": "object",
              "properties": {
                "title": {"type": "string"},
                "labels": {"type": "array", "items": {"type": "string"}},
                "values": {"type": "array", "items": {"type": "number"}}
              },
              "required": ["title", "labels", "values"]
            }
        }]
      }'

## How function calling works

![function calling overview](https://ai.google.dev/static/gemini-api/docs/images/function-calling-overview.png)

Function calling involves a structured interaction between your application, the
model, and external functions:

1. **Define Function Declaration:** Define the function's name, parameters, and purpose to the model.
2. **Call LLM with function declarations:** Send user prompt along with the function declaration(s) to the model.
3. **Execute Function Code (Your Responsibility):** The model *doesn't* execute the function itself. Extract the name and args and execute in your application.
4. **Create User friendly response:** Send the result back to the model for a final, user-friendly response.

This process can be repeated over multiple turns. The model supports calling
multiple functions in a single turn ([parallel function calling](https://ai.google.dev/gemini-api/docs/function-calling#parallel_function_calling)) and in sequence ([compositional function calling](https://ai.google.dev/gemini-api/docs/function-calling#compositional_function_calling)).

### Step 1: Define a function declaration

### Python

    set_light_values_declaration = {
        "type": "function",
        "name": "set_light_values",
        "description": "Sets the brightness and color temperature of a light.",
        "parameters": {
            "type": "object",
            "properties": {
                "brightness": {
                    "type": "integer",
                    "description": "Light level from 0 to 100",
                },
                "color_temp": {
                    "type": "string",
                    "enum": ["daylight", "cool", "warm"],
                    "description": "Color temperature",
                },
            },
            "required": ["brightness", "color_temp"],
        },
    }

    def set_light_values(brightness: int, color_temp: str) -> dict:
        """Set the brightness and color temperature of a room light."""
        return {"brightness": brightness, "colorTemperature": color_temp}

### JavaScript

    const setLightValuesTool = {
      type: 'function',
      name: 'set_light_values',
      description: 'Sets the brightness and color temperature of a light.',
      parameters: {
        type: 'object',
        properties: {
          brightness: { type: 'number', description: 'Light level from 0 to 100' },
          color_temp: { type: 'string', enum: ['daylight', 'cool', 'warm'] },
        },
        required: ['brightness', 'color_temp'],
      },
    };

    function setLightValues(brightness, color_temp) {
      return { brightness: brightness, colorTemperature: color_temp };
    }

### Step 2: Call the model with function declarations

### Python

    from google import genai

    client = genai.Client()

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="Turn the lights down to a romantic level",
        tools=[set_light_values_declaration],
    )

    fc_step = next(s for s in interaction.steps if s.type == "function_call")
    print(fc_step)

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const interaction = await client.interactions.create({
      model: 'gemini-3.8-flash',
      input: 'Turn the lights down to a romantic level',
      tools: [setLightValuesTool],
    });

    const fcStep = interaction.steps.find(s => s.type === 'function_call');
    console.log(fcStep);

### Step 3: Execute the function

### Python

    fc_step = next(s for s in interaction.steps if s.type == "function_call")

    if fc_step.name == "set_light_values":
        result = set_light_values(**fc_step.arguments)
        print(f"Function execution result: {result}")

### JavaScript

    const fcStep = interaction.steps.find(s => s.type === 'function_call');

    let result;
    if (fcStep.name === 'set_light_values') {
      result = setLightValues(fcStep.arguments.brightness, fcStep.arguments.color_temp);
      console.log(`Function execution result: ${JSON.stringify(result)}`);
    }

### Step 4: Send result back to model

### Python

    final_interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input=[
            {
                "type": "function_result",
                "name": fc_step.name,
                "call_id": fc_step.id,
                "result": [{"type": "text", "text": json.dumps(result)}],
            }
        ],
        tools=[set_light_values_declaration],
        previous_interaction_id=interaction.id,
    )

    print(final_interaction.output_text)

### JavaScript

    const finalInteraction = await client.interactions.create({
      model: 'gemini-3.8-flash',
      input: [{
        type: 'function_result',
        name: fcStep.name,
        call_id: fcStep.id,
        result: [{ type: 'text', text: JSON.stringify(result) }]
      }],
      tools: [setLightValuesTool],
      previous_interaction_id: interaction.id,
    });

    console.log(finalInteraction.output_text);

### Stateless function calling

You can also use function calling in stateless mode by managing the conversation history on the client side and setting `store=false`.

In stateless mode, you must pass the full history of the conversation in the `input` field of each subsequent request. This history must include:
1. The initial `user_input` step.
2. All model-generated steps returned in Turn 1 (including `thought` and `function_call` steps) exactly as received.
3. The `function_result` step containing the output of your executed function.

### Python

    from google import genai
    import json

    client = genai.Client()

    history = [
        {
            "type": "user_input",
            "content": [{"type": "text", "text": "Turn the lights down to a romantic level"}]
        }
    ]

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        store=False,
        input=history,
        tools=[set_light_values_declaration],
    )

    for step in interaction.steps:
        history.append(step.model_dump())

    fc_step = next(s for s in interaction.steps if s.type == "function_call")
    if fc_step.name == "set_light_values":
        result = set_light_values(**fc_step.arguments)

    history.append({
        "type": "function_result",
        "name": fc_step.name,
        "call_id": fc_step.id,
        "result": [{"type": "text", "text": json.dumps(result)}],
    })

    final_interaction = client.interactions.create(
        model="gemini-3.8-flash",
        store=False,
        input=history,
        tools=[set_light_values_declaration],
    )

    print(final_interaction.output_text)

### JavaScript

    import { GoogleGenAI } from "@google/genai";

    const client = new GoogleGenAI({});

    async function main() {
      const history = [
        {
          type: "user_input",
          content: [{ type: "text", text: "Turn the lights down to a romantic level" }]
        }
      ];

      const interaction = await client.interactions.create({
        model: "gemini-3.8-flash",
        store: false,
        input: history,
        tools: [setLightValuesTool],
      });

      history.push(...interaction.steps);

      const fcStep = interaction.steps.find(s => s.type === 'function_call');
      let result;
      if (fcStep.name === 'set_light_values') {
        result = setLightValues(fcStep.arguments.brightness, fcStep.arguments.color_temp);
      }

      history.push({
        type: 'function_result',
        name: fcStep.name,
        call_id: fcStep.id,
        result: [{ type: 'text', text: JSON.stringify(result) }]
      });

      const finalInteraction = await client.interactions.create({
        model: 'gemini-3.8-flash',
        store: false,
        input: history,
        tools: [setLightValuesTool],
      });

      console.log(finalInteraction.output_text);
    }

    await main();

### REST

    # Turn 1: Send request with tools and store: false
    RESPONSE1=$(curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d '{
        "model": "gemini-3.8-flash",
        "store": false,
        "input": [
          {
            "type": "user_input",
            "content": "Turn the lights down to a romantic level"
          }
        ],
        "tools": [{
          "type": "function",
          "name": "set_light_values",
          "description": "Sets the brightness and color temperature of a light.",
          "parameters": {
            "type": "object",
            "properties": {
              "brightness": {"type": "integer", "description": "Light level from 0 to 100"},
              "color_temp": {"type": "string", "enum": ["daylight", "cool", "warm"]}
            },
            "required": ["brightness", "color_temp"]
          }
        }]
      }')

    # Extract model steps (thought, function_call)
    MODEL_STEPS=$(echo "$RESPONSE1" | jq '.steps')

    # Extract function call details to execute
    FC_NAME=$(echo "$RESPONSE1" | jq -r '.steps[] | select(.type=="function_call") | .name')
    FC_ID=$(echo "$RESPONSE1" | jq -r '.steps[] | select(.type=="function_call") | .id')

    # Assume local execution returns: {"brightness": 25, "colorTemperature": "warm"}
    RESULT="{\"brightness\": 25, \"colorTemperature\": \"warm\"}"

    # Reconstruct history for Turn 2
    HISTORY=$(jq -n \
      --argjson first_input '[{"type": "user_input", "content": "Turn the lights down to a romantic level"}]' \
      --argjson model_steps "$MODEL_STEPS" \
      --arg fc_name "$FC_NAME" \
      --arg fc_id "$FC_ID" \
      --arg result "$RESULT" \
      '$first_input + $model_steps + [{"type": "function_result", "name": $fc_name, "call_id": $fc_id, "result": [{"type": "text", "text": $result}]}]')

    # Turn 2: Send the full history
    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d "{
        \"model\": \"gemini-3.8-flash\",
        \"store\": false,
        \"input\": $HISTORY,
        \"tools\": [{
          \"type\": \"function\",
          \"name\": \"set_light_values\",
          \"description\": \"Sets the brightness and color temperature of a light.\",
          \"parameters\": {
            \"type\": \"object\",
            \"properties\": {
              \"brightness\": {\"type\": \"integer\"},
              \"color_temp\": {\"type\": \"string\"}
            },
            \"required\": [\"brightness\", \"color_temp\"]
          }
        }]
      }"

## Function declarations

A function declaration is passed as a tool and includes:

- `type` (string): Must be `"function"` for custom functions.
- `name` (string): Unique function name (use underscores or camelCase).
- `description` (string): Clear explanation of the function's purpose.
- `parameters` (object): Input parameters the function expects.
  - `type` (string): Overall data type, such as `object`.
  - `properties` (object): Individual parameters with type and description.
  - `required` (array): Mandatory parameter names.

## Function calling with thinking models

Gemini 3 series models use an internal ["thinking"](https://ai.google.dev/gemini-api/docs/thinking) process that improves function calling. The SDKs automatically handle [thought signatures](https://ai.google.dev/gemini-api/docs/thought-signatures) for you.

## Parallel function calling

Call multiple functions at once when they are independent:

### Python

    power_disco_ball = {"type": "function", "name": "power_disco_ball", "description": "Powers the disco ball.",
        "parameters": {"type": "object", "properties": {"power": {"type": "boolean"}}, "required": ["power"]}}
    start_music = {"type": "function", "name": "start_music", "description": "Play music.",
        "parameters": {"type": "object", "properties": {"energetic": {"type": "boolean"}, "loud": {"type": "boolean"}}, "required": ["energetic", "loud"]}}
    dim_lights = {"type": "function", "name": "dim_lights", "description": "Dim the lights.",
        "parameters": {"type": "object", "properties": {"brightness": {"type": "number"}}, "required": ["brightness"]}}

    client = genai.Client()

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="Turn this place into a party!",
        tools=[power_disco_ball, start_music, dim_lights],
        generation_config={"tool_choice": "any"},
    )

    for step in interaction.steps:
        if step.type == "function_call":
            args = ", ".join(f"{key}={val}" for key, val in step.arguments.items())
            print(f"{step.name}({args})")

### JavaScript

    const powerDiscoBall = { type: 'function', name: 'power_disco_ball', description: 'Powers the disco ball.',
      parameters: { type: 'object', properties: { power: { type: 'boolean' } }, required: ['power'] } };
    const startMusic = { type: 'function', name: 'start_music', description: 'Play music.',
      parameters: { type: 'object', properties: { energetic: { type: 'boolean' }, loud: { type: 'boolean' } }, required: ['energetic', 'loud'] } };
    const dimLights = { type: 'function', name: 'dim_lights', description: 'Dim the lights.',
      parameters: { type: 'object', properties: { brightness: { type: 'number' } }, required: ['brightness'] } };

    const interaction = await client.interactions.create({
      model: 'gemini-3.8-flash',
      input: 'Turn this place into a party!',
      tools: [powerDiscoBall, startMusic, dimLights],
      generation_config: { tool_choice: 'any' },
    });

    for (const step of interaction.steps) {
      if (step.type === 'function_call') {
        console.log(`${step.name}(${JSON.stringify(step.arguments)})`);
      }
    }

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d '{
        "model": "gemini-3.8-flash",
        "input": "Turn this place into a party!",
        "tools": [
          {
            "type": "function",
            "name": "power_disco_ball",
            "description": "Powers the disco ball.",
            "parameters": {
              "type": "object",
              "properties": {
                "power": {"type": "boolean"}
              },
              "required": ["power"]
            }
          },
          {
            "type": "function",
            "name": "start_music",
            "description": "Play music.",
            "parameters": {
              "type": "object",
              "properties": {
                "energetic": {"type": "boolean"},
                "loud": {"type": "boolean"}
              },
              "required": ["energetic", "loud"]
            }
          },
          {
            "type": "function",
            "name": "dim_lights",
            "description": "Dim the lights.",
            "parameters": {
              "type": "object",
              "properties": {
                "brightness": {"type": "number"}
              },
              "required": ["brightness"]
            }
          }
        ]
      }'

## Compositional function calling

Chain multiple function calls together for complex requests (e.g., get location
first, then get weather for that location).

### Python

    get_weather_forecast_declaration = {
        "type": "function",
        "name": "get_weather_forecast",
        "description": "Gets the current weather temperature for a given location.",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "The location"},
            },
            "required": ["location"],
        },
    }

    set_thermostat_temperature_declaration = {
        "type": "function",
        "name": "set_thermostat_temperature",
        "description": "Sets the thermostat to a desired temperature.",
        "parameters": {
            "type": "object",
            "properties": {
                "temperature": {
                    "type": "integer",
                    "description": "The temperature in Celsius",
                },
            },
            "required": ["temperature"],
        },
    }

    client = genai.Client()

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="If it's warmer than 20°C in London, set the thermostat to 20°C, otherwise 18°C.",
        tools=[
            get_weather_forecast_declaration,
            set_thermostat_temperature_declaration,
        ],
    )

    for step in interaction.steps:
        if step.type == "function_call":
            print(f"Function to call: {step.name}")
            print(f"Arguments: {step.arguments}")
        elif hasattr(step, "content") and step.content:
             for part in step.content:
                 if hasattr(part, "text"):
                     print(part.text)

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const getWeatherForecastTool = {
      type: 'function',
      name: 'get_weather_forecast',
      description: 'Gets the current weather temperature for a given location.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'The location' },
        },
        required: ['location'],
      },
    };

    const setThermostatTemperatureTool = {
      type: 'function',
      name: 'set_thermostat_temperature',
      description: 'Sets the thermostat to a desired temperature.',
      parameters: {
        type: 'object',
        properties: {
          temperature: {
            type: 'integer',
            description: 'The temperature in Celsius',
          },
        },
        required: ['temperature'],
      },
    };

    const interaction = await client.interactions.create({
      model: 'gemini-3.8-flash',
      input: "If it's warmer than 20°C in London, set the thermostat to 20°C, otherwise 18°C.",
      tools: [
        getWeatherForecastTool,
        setThermostatTemperatureTool,
      ],
    });

    for (const step of interaction.steps) {
      if (step.type === 'function_call') {
        console.log(`Function to call: ${step.name}`);
        console.log(`Arguments: ${JSON.stringify(step.arguments)}`);
      } else if (step.content) {
        for (const part of step.content) {
          if (part.text) {
            console.log(part.text);
          }
        }
      }
    }

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d '{
        "model": "gemini-3.8-flash",
        "input": "If it'\''s warmer than 20°C in London, set the thermostat to 20°C, otherwise 18°C.",
        "tools": [
          {
            "type": "function",
            "name": "get_weather_forecast",
            "description": "Gets the current weather temperature for a given location.",
            "parameters": {
              "type": "object",
              "properties": {
                "location": {"type": "string"}
              },
              "required": ["location"]
            }
          },
          {
            "type": "function",
            "name": "set_thermostat_temperature",
            "description": "Sets the thermostat to a desired temperature.",
            "parameters": {
              "type": "object",
              "properties": {
                "temperature": {"type": "integer"}
              },
              "required": ["temperature"]
            }
          }
        ]
      }'

## Function calling modes

Control how the model uses tools using `tool_choice` in `generation_config`:

- `auto` (Default): Model decides whether to call a function or respond directly.
- `any`: Model is constrained to always predict a function call.
- `none`: Model is prohibited from making function calls.
- `validated`: Model ensures function schema adherence.

### Python

    generation_config = {
        "tool_choice": {
            "allowed_tools": {
                "mode": "any",
                "tools": ["get_current_temperature"]
            }
        }
    }

### JavaScript

    const generation_config = {
      tool_choice: {
        allowed_tools: {
          mode: 'any',
          tools: ['get_current_temperature']
        }
      }
    };

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d '{
        "model": "gemini-3.8-flash",
        "input": "What is the temperature in Boston?",
        "tools": [{
          "type": "function",
          "name": "get_current_temperature",
          "description": "Gets the current temperature for a given location.",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {"type": "string"}
            },
            "required": ["location"]
          }
        }],
        "generation_config": {
          "tool_choice": {
            "allowed_tools": {
              "mode": "any",
              "tools": ["get_current_temperature"]
            }
          }
        }
      }'

## Multi-tool use

You can enable multiple tools, combining built-in tools with function calling in
the same request. Gemini 3 models can combine built-in tools with function
calling out-of-the-box in Interactions. Passing `previous_interaction_id`
automatically circulates the built-in tool context.

### Python

    from google import genai
    import json

    client = genai.Client()

    get_weather = {
        "type": "function",
        "name": "get_weather",
        "description": "Gets the weather for a requested city.",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {
                    "type": "string",
                    "description": "The city and state, e.g. Utqiaġvik, Alaska",
                },
            },
            "required": ["city"],
        },
    }

    tools = [
        {"type": "google_search"},
        get_weather
    ]

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="What is the northernmost city in the United States? What's the weather like there today?",
        tools=tools
    )

    for step in interaction.steps:
        if step.type == "function_call":
            print(f"Function call: {step.name} (ID: {step.id})")
            result = {"response": "Very cold. 22 degrees Fahrenheit."}
            interaction_2 = client.interactions.create(
                model="gemini-3.8-flash",
                previous_interaction_id=interaction.id,
                tools=tools,
                input=[{
                    "type": "function_result",
                    "name": step.name,
                    "call_id": step.id,
                    "result": [{"type": "text", "text": json.dumps(result)}]
                }]
            )

            print(interaction_2.output_text)

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const weatherTool = {
      type: 'function',
      name: 'get_weather',
      description: 'Gets the weather for a given location.',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The city and state, e.g. San Francisco, CA',
          },
        },
        required: ['location'],
      },
    };

    const tools = [
      { type: 'google_search' }, // Built-in tool
      weatherTool,
    ];

    const interaction = await client.interactions.create({
      model: 'gemini-3.8-flash',
      input: "What is the northernmost city in the United States? What's the weather like there today?",
      tools: tools,
    });

    for (const step of interaction.steps) {
      if (step.type === 'function_call') {
        console.log(`Function call: ${step.name} (ID: ${step.id})`);
        const result = { response: 'Very cold. 22 degrees Fahrenheit.' };
        const interaction_2 = await client.interactions.create({
          model: 'gemini-3.8-flash',
          previous_interaction_id: interaction.id,
          tools: tools,
          input: [
            {
              type: 'function_result',
              name: step.name,
              call_id: step.id,
              result: [{ type: 'text', text: JSON.stringify(result) }],
            },
          ],
        });

        console.log(interaction_2.output_text);
      }
    }

### REST

    # Turn 1: Send request with built-in google_search tool and custom weather tool
    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d '{
        "model": "gemini-3.8-flash",
        "input": "What is the northernmost city in the United States? What'\''s the weather like there today?",
        "tools": [
          {"type": "google_search"},
          {
            "type": "function",
            "name": "get_weather",
            "description": "Gets the weather for a given location.",
            "parameters": {
              "type": "object",
              "properties": {
                "location": {"type": "string", "description": "The city and state, e.g. San Francisco, CA"}
              },
              "required": ["location"]
            }
          }
        ]
      }'

    # Turn 2: Provide function result and pass previous_interaction_id
    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d '{
        "model": "gemini-3.8-flash",
        "previous_interaction_id": "INTERACTION_ID",
        "tools": [
          {"type": "google_search"},
          {
            "type": "function",
            "name": "get_weather",
            "description": "Gets the weather for a given location.",
            "parameters": {
              "type": "object",
              "properties": {
                "location": {"type": "string", "description": "The city and state, e.g. San Francisco, CA"}
              },
              "required": ["location"]
            }
          }
        ],
        "input": [
          {
            "type": "function_result",
            "name": "get_weather",
            "call_id": "call_123",
            "result": [{"type": "text", "text": "{\"response\": \"Very cold. 22 degrees Fahrenheit.\"}"}]
          }
        ]
      }'

## Multimodal function responses

For Gemini 3 series models, you can include multimodal content in
the function response parts that you send to the model. The model can process
this multimodal content in its next turn to produce a more informed response.

To include multimodal data in a function response, include it as one or more content blocks in the `result` field of the `function_result` step. Each content block must specify its `type` (e.g., `"text"`, `"image"`).

The following example shows how to send a function response containing image data back to the model in an interaction:

### Python

    import base64
    from google import genai
    import requests

    client = genai.Client()

    tool_call = next(s for s in interaction.steps if s.type == "function_call")

    image_path = "https://goo.gle/instrument-img"
    image_bytes = requests.get(image_path).content

    base64_image_data = base64.b64encode(image_bytes).decode("utf-8")

    final_interaction = client.interactions.create(
        model="gemini-3.8-flash",
        previous_interaction_id=interaction.id,
        input=[
            {
                "type": "function_result",
                "name": tool_call.name,
                "call_id": tool_call.id,
                "result": [
                    {"type": "text", "text": "instrument.jpg"},
                    {
                        "type": "image",
                        "mime_type": "image/jpeg",
                        "data": base64_image_data,
                    },
                ],
            }
        ],
    )

    print(final_interaction.output_text)

### JavaScript

    import { GoogleGenAI } from "@google/genai";

    const client = new GoogleGenAI({});

    const toolCall = interaction.steps.find(s => s.type === 'function_call');

    const base64ImageData = "BASE64_IMAGE_DATA";

    const finalInteraction = await client.interactions.create({
        model: 'gemini-3.8-flash',
        previous_interaction_id: interaction.id,
        input: [{
            type: 'function_result',
            name: toolCall.name,
            call_id: toolCall.id,
            result: [
                { type: 'text', text: 'instrument.jpg' },
                {
                    type: 'image',
                    mime_type: 'image/jpeg',
                    data: base64ImageData,
                }
            ]
        }]
    });

    console.log(finalInteraction.output_text);

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d '{
        "model": "gemini-3.8-flash",
        "previous_interaction_id": "INTERACTION_ID",
        "input": [
          {
            "type": "function_result",
            "name": "get_image",
            "call_id": "call_123",
            "result": [
              {"type": "text", "text": "instrument.jpg"},
              {
                "type": "image",
                "mime_type": "image/jpeg",
                "data": "BASE64_IMAGE_DATA"
              }
            ]
          }
        ]
      }'

## Function calling with Structured output

For Gemini 3 series models, combine function calling with
[structured output](https://ai.google.dev/gemini-api/docs/structured-output) for
consistently formatted responses.

## Remote MCP (Model Context Protocol)

Interactions API supports connecting to remote MCP servers to give the model access to external tools and services. You provide the server `name` and `url` in the tools configuration.

When using Remote MCP, be aware of the following constraints:

- **Server types**: Remote MCP only works with Streamable HTTP servers. SSE (Server-Sent Events) servers are not supported.
- **Naming** : MCP server names should not include the `-` character. Use `snake_case` server names instead.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `string` | Yes | Must be `"mcp_server"`. |
| `name` | `string` | No | A display name for the MCP server. |
| `url` | `string` | No | The full URL for the MCP server endpoint. |
| `headers` | `object` | No | Key-value pairs sent as HTTP headers with every request to the server (for example, authentication tokens). |
| `allowed_tools` | `array` | No | Restrict which tools from the server the agent may call. |

### Example

### Python

    from google import genai

    client = genai.Client()

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="Check the weather in San Francisco.",
        tools=[
            {
                "type": "mcp_server",
                "name": "weather",
                "url": "https://gemini-api-demos.uc.r.appspot.com/mcp",
            }
        ]
    )

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const interaction = await client.interactions.create({
        model: 'gemini-3.8-flash',
        input: 'Check the weather in San Francisco.',
        tools: [
            {
                type: 'mcp_server',
                name: 'weather',
                url: 'https://gemini-api-demos.uc.r.appspot.com/mcp'
            }
        ]
    });

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "Content-Type: application/json" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "model": "gemini-3.8-flash",
        "input": "Check the weather in San Francisco.",
        "tools": [
            {
                "type": "mcp_server",
                "name": "weather",
                "url": "https://gemini-api-demos.uc.r.appspot.com/mcp"
            }
        ]
    }'

## Stream tool calls

When using tools with streaming, the model generates function calls as a
sequence of `step.delta` events on the stream. Tool arguments can be streamed
as partial arguments using `arguments`. You must aggregate these deltas to
reconstruct the complete tool calls before executing them.

### Python

    import json
    from google import genai

    client = genai.Client()

    weather_tool = {
        "type": "function",
        "name": "get_weather",
        "description": "Gets the weather for a given location.",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "The city and state"}
            },
            "required": ["location"]
        }
    }

    stream = client.interactions.create(
        model="gemini-3.8-flash",
        input="What is the weather in Paris?",
        tools=[weather_tool],
        stream=True
    )

    current_calls = {}
    tool_calls = []

    for event in stream:
        if event.event_type == "step.start":
            if event.step.type == "function_call":
                current_calls[event.index] = {
                    "id": event.step.id,
                    "name": event.step.name,
                    "arguments": ""
                }
                if hasattr(event.step, "arguments") and event.step.arguments:
                    if isinstance(event.step.arguments, dict):
                        current_calls[event.index]["arguments"] = json.dumps(event.step.arguments)
                    else:
                        current_calls[event.index]["arguments"] = event.step.arguments
        elif event.event_type == "step.delta":
            if event.delta.type == "arguments":
                if event.index in current_calls:
                    current_calls[event.index]["arguments"] += event.delta.partial_arguments
            elif event.delta.type == "text":
                print(event.delta.text, end="", flush=True)

        elif event.event_type == "interaction.completed":
            for index, call in current_calls.items():
                args = call["arguments"]
                if args:
                    args = json.loads(args)
                else:
                    args = {}

                tool_calls.append({
                    "type": "function_call",
                    "id": call["id"],
                    "name": call["name"],
                    "arguments": args
                })

            print(f"\nFinal tool calls ready to execute:")
            print(json.dumps(tool_calls, indent=2))

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const weatherTool = {
        type: 'function',
        name: 'get_weather',
        description: 'Gets the weather for a given location.',
        parameters: {
            type: 'object',
            properties: {
                location: { type: 'string', description: 'The city and state' }
            },
            required: ['location']
        }
    };

    const stream = await client.interactions.create({
        model: 'gemini-3.8-flash',
        input: 'What is the weather in Paris?',
        tools: [weatherTool],
        stream: true,
    });

    const currentCalls = new Map();
    let toolCalls = [];

    for await (const event of stream) {
        const evType = event.event_type;
        if (evType === 'step.start') {
            if (event.step.type === 'function_call') {
                currentCalls.set(event.index, {
                    id: event.step.id,
                    name: event.step.name,
                    arguments: ''
                });
                if (event.step.arguments) {
                    if (typeof event.step.arguments === 'object') {
                        currentCalls.get(event.index).arguments = JSON.stringify(event.step.arguments);
                    } else {
                        currentCalls.get(event.index).arguments = event.step.arguments;
                    }
                }
            }
        } else if (evType === 'step.delta') {
            if (event.delta.type === 'arguments') {
                if (currentCalls.has(event.index)) {
                    currentCalls.get(event.index).arguments += event.delta.partial_arguments;
                }
            } else if (event.delta.type === 'text') {
                process.stdout.write(event.delta.text);
            }
        } else if (evType === 'interaction.completed' || evType === 'interaction.complete') {
            toolCalls = Array.from(currentCalls.values()).map(call => ({
                type: 'function_call',
                id: call.id,
                name: call.name,
                arguments: call.arguments ? JSON.parse(call.arguments) : {}
            }));
            console.log('\nFinal tool calls ready to execute:');
            console.log(JSON.stringify(toolCalls, null, 2));
        }
    }

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse" \
      -H "Content-Type: application/json" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "model": "gemini-3.8-flash",
        "input": "What is the weather in Paris?",
        "tools": [{
            "type": "function",
            "name": "get_weather",
            "description": "Gets the weather for a given location.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "The city and state"}
                },
                "required": ["location"]
            }
        }],
        "stream": true
    }'

## Best practices

- **Function and Parameter Descriptions:** Be clear and specific.
- **Naming:** Use descriptive names without spaces or special characters.
- **Strong Typing:** Use specific types (integer, string, enum).
- **Tool Selection:** Keep active set to 10-20 tools maximum.
- **Prompt Engineering:** Provide context and instructions.
- **Validation:** Validate function calls before executing.
- **Error Handling:** Implement robust error handling.
- **Security:** Use appropriate authentication for external APIs.

## Workarounds for pre-tool text requirements

**Issue:** If your prompt requires the model to output structured text (XML, YAML, JSON, etc.) (e.g., `<UPDATE>...</UPDATE>`) immediately before making a tool call, the tool call may occasionally fail with `Malformed_Function_Call`.

**Solutions:** The following workarounds resolve this issue:

- **PREFERRED:** Instruct the model to put its pre-tool notes inside a dedicated `update()` function call instead of raw text (details below).
- Instruct the model to write notes as Markdown headers (`# UPDATE`, `## PLAN`) instead of structured text.
- Do not require the model to output text before tool calls.

### Preferred workaround: Wrap working notes in a dedicated function call

Instead of the original instruction:

    Before calling a tool, in every response you MUST first output a single `<UPDATE>` part as specified, don't skip this part or any of required sub-tags within `<UPDATE>`.

Use this updated instruction:

    Before calling any other tool, in every response you MUST first call `update` with all required parameters (previous_step, plan, next_step, external).

And update all references to the old `<UPDATE>` XML format in the customer request. Then add the corresponding function declaration for the update function:

    {
      "name": "update",
      "description": "Update working notes (previous step analysis, plan, next step, external note).",
      "parameters": {
        "type": "OBJECT",
        "properties": {
          "previous_step": {
            "type": "STRING",
            "description": "Key findings and outcomes since the previous step."
          },
          "plan": {
            "type": "STRING",
            "description": "The current status of the plan."
          },
          "next_step": {
            "type": "STRING",
            "description": "Brief explanation of the immediate next action according to the plan."
          },
          "external": {
            "type": "STRING",
            "description": "A short, plain-language note shown to the User about what you are ABOUT TO DO next."
          }
        },
        "required": [
          "previous_step",
          "plan",
          "next_step",
          "external"
        ]
      }
    }

Then the model will make two calls in the same step: the `update()` call that replaces the structured XML, and the actual function call it wants to make.

## Notes and limitations

- Only a [subset of the OpenAPI schema](https://ai.google.dev/api/rest/v1beta/cachedContents#FunctionDeclaration) is supported.
- For `any` mode, the API may reject very large or deeply nested schemas.
- Supported parameter types in Python are limited.
