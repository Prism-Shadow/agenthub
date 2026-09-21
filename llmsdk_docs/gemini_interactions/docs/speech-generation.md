> Source: https://ai.google.dev/gemini-api/docs/speech-generation (snapshot 2026-09-16)
>
> Java samples and the "Prompting guide" section removed.

<br />

The Gemini API can transform text input into single speaker or multi-speaker
audio using Gemini text-to-speech (TTS) generation capabilities.
Text-to-speech (TTS) generation is *[controllable](https://ai.google.dev/gemini-api/docs/speech-generation#controllable)* ,
meaning you can use natural language to structure interactions and guide the
*style* , *accent* , *pace* , and *tone* of the audio.

The TTS capability differs from speech generation provided through the
[Live API](https://ai.google.dev/gemini-api/docs/live), which is designed for interactive,
unstructured audio, and multimodal inputs and outputs. While the Live API excels
in dynamic conversational contexts, TTS through the Gemini API
is tailored for scenarios that require exact text recitation with fine-grained
control over style and sound, such as podcast or audiobook generation.

This guide shows you how to generate single-speaker and multi-speaker audio from
text.

> [!WARNING]
> **Preview:** Gemini text-to-speech (TTS) is in [Preview](https://ai.google.dev/gemini-api/docs/models#preview).

## Before you begin

Ensure you use a Gemini 2.5 model variant with Gemini text-to-speech (TTS)
capabilities, as listed in the [Supported models](https://ai.google.dev/gemini-api/docs/speech-generation#supported-models)
section. For optimal results, consider which model best fits your specific
use case.

You may find it useful to [test the Gemini TTS models in AI Studio](https://aistudio.google.com/generate-speech) before you start building.

> [!NOTE]
> **Note:** TTS models accept text-only inputs and produce audio-only outputs. For a complete list of restrictions specific to TTS models, review the [Limitations](https://ai.google.dev/gemini-api/docs/speech-generation#limitations) section.

## Single-speaker TTS

To convert text to single-speaker audio, set the response modality to "audio",
and pass a `speech_config` object with a voice name.
You'll need to choose a voice name from the prebuilt [output voices](https://ai.google.dev/gemini-api/docs/speech-generation#voices).

This example saves the output audio from the model in a wave file:

### Python

    from google import genai
    import wave
    import base64

    def wave_file(filename, pcm, channels=1, rate=24000, sample_width=2):
        with wave.open(filename, "wb") as wf:
            wf.setnchannels(channels)
            wf.setsampwidth(sample_width)
            wf.setframerate(rate)
            wf.writeframes(pcm)

    client = genai.Client()

    interaction = client.interactions.create(
        model="gemini-3.1-flash-tts-preview",
        input="Say cheerfully: Have a wonderful day!",
        response_format={"type": "audio"},
        generation_config={
            "speech_config": [
                {"voice": "Kore"}
            ]
        }
    )

    wave_file('out.wav', base64.b64decode(interaction.output_audio.data))

### JavaScript

    import {GoogleGenAI} from '@google/genai';
    import wav from 'wav';

    async function saveWaveFile(
       filename,
       pcmData,
       channels = 1,
       rate = 24000,
       sampleWidth = 2,
    ) {
       return new Promise((resolve, reject) => {
          const writer = new wav.FileWriter(filename, {
                channels,
                sampleRate: rate,
                bitDepth: sampleWidth * 8,
          });

          writer.on('finish', resolve);
          writer.on('error', reject);

          writer.write(pcmData);
          writer.end();
       });
    }

    async function main() {
       const client = new GoogleGenAI({});

       const interaction = await client.interactions.create({
          model: "gemini-3.1-flash-tts-preview",
          input: "Say cheerfully: Have a wonderful day!",
          response_format: { type: 'audio' },
          generation_config: {
             speech_config: [
                { voice: 'Kore' }
             ]
          },
        });

       const audioBuffer = Buffer.from(interaction.output_audio.data, 'base64');

       await saveWaveFile('out.wav', audioBuffer);
    }
    await main();

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "gemini-3.1-flash-tts-preview",
        "input": "Say cheerfully: Have a wonderful day!",
        "response_format": {
           "type": "audio"
         },
        "generation_config": {
          "speech_config": [
            { "voice": "Kore" }
          ]
        }
      }'

You can retrieve generated audio data by using the `interaction.output_audio`
property, which returns the last generated audio block. For details on
convenience properties, see the
[Interactions overview](https://ai.google.dev/gemini-api/docs/interactions-overview#convenience-properties).

## Multi-speaker TTS

For multi-speaker audio, you'll need a `multi_speaker_voice_config` object with
each speaker (up to 2) configured as a `speaker_voice_config`.
You'll need to define each `speaker` with the same names used in the
[prompt](https://ai.google.dev/gemini-api/docs/speech-generation#controllable):

### Python

    from google import genai
    import wave
    import base64

    def wave_file(filename, pcm, channels=1, rate=24000, sample_width=2):
       with wave.open(filename, "wb") as wf:
          wf.setnchannels(channels)
          wf.setsampwidth(sample_width)
          wf.setframerate(rate)
          wf.writeframes(pcm)

    client = genai.Client()

    prompt = """TTS the following conversation between Joe and Jane:
             Joe: How's it going today Jane?
             Jane: Not too bad, how about you?"""

     interaction = client.interactions.create(
         model="gemini-3.1-flash-tts-preview",
         input=prompt,
         response_format={"type": "audio"},
         generation_config={
             "speech_config": [
                 {"speaker": "Joe", "voice": "Kore"},
                 {"speaker": "Jane", "voice": "Puck"}
             ]
         }
     )

    wave_file('out.wav', base64.b64decode(interaction.output_audio.data))

### JavaScript

    import {GoogleGenAI} from '@google/genai';
    import wav from 'wav';

    async function saveWaveFile(
       filename,
       pcmData,
       channels = 1,
       rate = 24000,
       sampleWidth = 2,
    ) {
       return new Promise((resolve, reject) => {
          const writer = new wav.FileWriter(filename, {
                channels,
                sampleRate: rate,
                bitDepth: sampleWidth * 8,
          });

          writer.on('finish', resolve);
          writer.on('error', reject);

          writer.write(pcmData);
          writer.end();
       });
    }

    async function main() {
       const client = new GoogleGenAI({});

       const prompt = `TTS the following conversation between Joe and Jane:
             Joe: How's it going today Jane?
             Jane: Not too bad, how about you?`;

       const interaction = await client.interactions.create({
          model: "gemini-3.1-flash-tts-preview",
          input: prompt,
          response_format: { type: 'audio' },
          generation_config: {
             speech_config: [
                { speaker: 'Joe', voice: 'Kore' },
                { speaker: 'Jane', voice: 'Puck' }
             ]
          },
       });

       const audioBuffer = Buffer.from(interaction.output_audio.data, 'base64');

       await saveWaveFile('out.wav', audioBuffer);
    }

    await main();

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
      "model": "gemini-3.1-flash-tts-preview",
      "input": "TTS the following conversation between Joe and Jane: Joe: Hows it going today Jane? Jane: Not too bad, how about you?",
      "response_format": {
           "type": "audio"
         },
      "generation_config": {
        "speech_config": [
          { "speaker": "Joe", "voice": "Kore" },
          { "speaker": "Jane", "voice": "Puck" }
        ]
      }
    }'

## Control speech style with prompts

You can control style, tone, accent, and pace using natural language prompts
for both single- and multi-speaker TTS.
For example, in a single-speaker prompt, you can say:

    Say in an spooky whisper:
    "By the pricking of my thumbs...
    Something wicked this way comes"

In a multi-speaker prompt, provide the model with each speaker's name and
corresponding transcript. You can also provide guidance for each speaker
individually:

    Make Speaker1 sound tired and bored, and Speaker2 sound excited and happy:

    Speaker1: So... what's on the agenda today?
    Speaker2: You're never going to guess!

Try using a [voice option](https://ai.google.dev/gemini-api/docs/speech-generation#voices) that corresponds to the style or emotion you
want to convey, to emphasize it even more. In the previous prompt, for example,
*Enceladus* 's breathiness might emphasize "tired" and "bored", while
*Puck*'s upbeat tone could complement "excited" and "happy".

> [!TIP]
> **Tip:** The \[Voice Library\] applet in Google AI Studio is a great way to try out speech styles and voices with Gemini TTS.

## Generate a prompt to convert to audio

The TTS models only output audio, but you can use
[other models](https://ai.google.dev/gemini-api/docs/models) to generate a transcript first,
then pass that transcript to the TTS model to read aloud.

### Python

    from google import genai

    client = genai.Client()

    transcript_interaction = client.interactions.create(
       model="gemini-3.8-flash",
       input="""Generate a short transcript around 100 words that reads
                like it was clipped from a podcast by excited herpetologists.
                The hosts names are Dr. Anya and Liam."""
    )
    transcript = transcript_interaction.output_text

    tts_interaction = client.interactions.create(
       model="gemini-3.1-flash-tts-preview",
       input=transcript,
       response_format={"type": "audio"},
       generation_config={
          "speech_config": [
             {"speaker": "Dr. Anya", "voice": "Kore"},
             {"speaker": "Liam", "voice": "Puck"}
          ]
       }
    )

### JavaScript

    import { GoogleGenAI } from "@google/genai";

    const client = new GoogleGenAI({});

    async function main() {

    const transcriptInteraction = await client.interactions.create({
       model: "gemini-3.8-flash",
       input: "Generate a short transcript around 100 words that reads like it was clipped from a podcast by excited herpetologists. The hosts names are Dr. Anya and Liam.",
       })

    const ttsInteraction = await client.interactions.create({
       model: "gemini-3.1-flash-tts-preview",
       input: transcriptInteraction.output_text,
       response_format: { type: 'audio' },
       generation_config: {
          speech_config: [
             { speaker: "Dr. Anya", voice: "Kore" },
             { speaker: "Liam", voice: "Puck" }
          ]
       }
      });
    }

    await main();

## Streaming speech generation

You can stream the generated audio as it is being generated by the model by setting `stream: true`.

> [!NOTE]
> **Note:** Streaming is supported for Text-to-Speech (TTS) models starting with version 3.1 (including `gemini-3.1-flash-tts-preview`).

### Python

    from google import genai
    import base64

    client = genai.Client()

    stream = client.interactions.create(
        model="gemini-3.1-flash-tts-preview",
        input="Say cheerfully: Have a wonderful day!",
        response_format={"type": "audio"},
        generation_config={
            "speech_config": [
                {"voice": "Kore"}
            ]
        },
        stream=True
    )

    for event in stream:
        if event.event_type == "step.delta":
            if event.delta.type == "audio":
                audio_data = base64.b64decode(event.delta.data)
                # Process the audio chunk (e.g. play it or write to a file)

### JavaScript

    import {GoogleGenAI} from '@google/genai';

    async function main() {
       const client = new GoogleGenAI({});

       const stream = await client.interactions.create({
          model: "gemini-3.1-flash-tts-preview",
          input: "Say cheerfully: Have a wonderful day!",
          response_format: { type: 'audio' },
          generation_config: {
             speech_config: [
                { voice: 'Kore' }
             ]
          },
          stream: true
       });

       for await (const event of stream) {
          if (event.event_type === 'step.delta') {
             if (event.delta.type === 'audio') {
                const audioBuffer = Buffer.from(event.delta.data, 'base64');
                // Process the audio buffer
             }
          }
       }
    }
    await main();

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions"       -H "x-goog-api-key: $GEMINI_API_KEY"       -H "Content-Type: application/json"       -H "Api-Revision: 2026-05-20"       --no-buffer       -d '{
        "model": "gemini-3.1-flash-tts-preview",
        "input": "Say cheerfully: Have a wonderful day!",
        "response_format": {
          "type": "audio"
        },
        "generation_config": {
          "speech_config": [
            { "voice": "Kore" }
          ]
        },
        "stream": true
      }'

## Voice options

TTS models support the following 30 voice options in the `voice_name` field:

|---|---|---|
| **Zephyr** -- *Bright* | **Puck** -- *Upbeat* | **Charon** -- *Informative* |
| **Kore** -- *Firm* | **Fenrir** -- *Excitable* | **Leda** -- *Youthful* |
| **Orus** -- *Firm* | **Aoede** -- *Breezy* | **Callirrhoe** -- *Easy-going* |
| **Autonoe** -- *Bright* | **Enceladus** -- *Breathy* | **Iapetus** -- *Clear* |
| **Umbriel** -- *Easy-going* | **Algieba** -- *Smooth* | **Despina** -- *Smooth* |
| **Erinome** -- *Clear* | **Algenib** -- *Gravelly* | **Rasalgethi** -- *Informative* |
| **Laomedeia** -- *Upbeat* | **Achernar** -- *Soft* | **Alnilam** -- *Firm* |
| **Schedar** -- *Even* | **Gacrux** -- *Mature* | **Pulcherrima** -- *Forward* |
| **Achird** -- *Friendly* | **Zubenelgenubi** -- *Casual* | **Vindemiatrix** -- *Gentle* |
| **Sadachbia** -- *Lively* | **Sadaltager** -- *Knowledgeable* | **Sulafat** -- *Warm* |

You can hear all the voice options in [AI Studio](https://aistudio.google.com/generate-speech).

## Supported languages

The TTS models detect the input language automatically. The following languages
are supported:

| Language | BCP-47 Code | Language | BCP-47 Code |
|---|---|---|---|
| Arabic | ar | Filipino | fil |
| Bangla | bn | Finnish | fi |
| Dutch | nl | Galician | gl |
| English | en | Georgian | ka |
| French | fr | Greek | el |
| German | de | Gujarati | gu |
| Hindi | hi | Haitian Creole | ht |
| Indonesian | id | Hebrew | he |
| Italian | it | Hungarian | hu |
| Japanese | ja | Icelandic | is |
| Korean | ko | Javanese | jv |
| Marathi | mr | Kannada | kn |
| Polish | pl | Konkani | kok |
| Portuguese | pt | Lao | lo |
| Romanian | ro | Latin | la |
| Russian | ru | Latvian | lv |
| Spanish | es | Lithuanian | lt |
| Tamil | ta | Luxembourgish | lb |
| Telugu | te | Macedonian | mk |
| Thai | th | Maithili | mai |
| Turkish | tr | Malagasy | mg |
| Ukrainian | uk | Malay | ms |
| Vietnamese | vi | Malayalam | ml |
| Afrikaans | af | Mongolian | mn |
| Albanian | sq | Nepali | ne |
| Amharic | am | Norwegian, Bokmål | nb |
| Armenian | hy | Norwegian, Nynorsk | nn |
| Azerbaijani | az | Odia | or |
| Basque | eu | Pashto | ps |
| Belarusian | be | Persian | fa |
| Bulgarian | bg | Punjabi | pa |
| Burmese | my | Serbian | sr |
| Catalan | ca | Sindhi | sd |
| Cebuano | ceb | Sinhala | si |
| Chinese, Mandarin | cmn | Slovak | sk |
| Croatian | hr | Slovenian | sl |
| Czech | cs | Swahili | sw |
| Danish | da | Swedish | sv |
| Estonian | et | Urdu | ur |

## Supported models

| Model | Single speaker | Multispeaker |
|---|---|---|
| [Gemini 3.1 Flash TTS Preview](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-tts-preview) | ✔️ | ✔️ |
| [Gemini 2.5 Flash Preview TTS](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-tts-preview) | ✔️ | ✔️ |
| [Gemini 2.5 Pro Preview TTS](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro-preview-tts) | ✔️ | ✔️ |

## Limitations

- TTS models can only receive text inputs and generate audio outputs.
- A TTS session has a [context window](https://ai.google.dev/gemini-api/docs/long-context) limit of 32k tokens.
- Review [Languages](https://ai.google.dev/gemini-api/docs/speech-generation#languages) section for language support.
- TTS does not support streaming, except when using `gemini-3.1-flash-tts-preview`.

The following constraints apply specifically when using the Gemini 3.1 Flash
TTS Preview model for speech generation:

- **Voice inconsistency with prompt instructions:** The model's output may not always strictly match the selected speaker, causing the audio to sound different than expected. To avoid mismatched tones (such as a deep male voice attempting to speak like a young girl), ensure your prompt's written tone and context align naturally with the selected speaker's profile.
- **Quality of longer outputs:** Speech quality and consistency may begin to drift with generated outputs that are longer than a few minutes. We recommend splitting your transcripts into smaller chunks.
- **Occasional text token returns:** The model occasionally returns text tokens instead of audio tokens, causing the server to fail the request with a `500` error. Because this occurs randomly in a very small percentage of requests, you should implement automated retry logic in your application to handle these.
- **Prompt classifier false rejections:** Vague prompts may fail to trigger the speech synthesis classifier, resulting in a rejected request (`PROHIBITED_CONTENT`) or causing the model to read your style instructions and director's notes aloud. Validate your prompts by adding a clear preamble instructing the model to synthesize speech, and explicitly label where the actual spoken transcript begins.

## What's next

- Gemini's [Live API](https://ai.google.dev/gemini-api/docs/live) offers interactive audio generation options you can interleave with other modalities.
- For working with audio *inputs* , visit the [Audio understanding](https://ai.google.dev/gemini-api/docs/audio) guide.
