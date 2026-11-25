import { Rpc } from '@opencode/plugin/rpc'

export const ContextMeter = Rpc.define({
  id: 'context-meter',
  methods: {
    composition: {
      input: {
        type: 'object',
        properties: { sessionID: { type: 'string', minLength: 1 } },
        required: ['sessionID'],
        additionalProperties: false,
      },
      output: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            properties: {
              skillChars: { type: 'integer', minimum: 0 },
              toolDefinitionChars: { type: 'integer', minimum: 0 },
              systemChars: { type: 'integer', minimum: 0 },
              contributors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    category: {
                      type: 'string',
                      enum: ['Skills', 'MCP & tool definitions', 'System & instructions'],
                    },
                    name: { type: 'string', minLength: 1 },
                    chars: { type: 'integer', minimum: 0 },
                  },
                  required: ['category', 'name', 'chars'],
                  additionalProperties: false,
                },
              },
              capturedAt: { type: 'integer', minimum: 0 },
              revision: { type: 'integer', minimum: 1 },
            },
            required: [
              'skillChars',
              'toolDefinitionChars',
              'systemChars',
              'contributors',
              'capturedAt',
              'revision',
            ],
            additionalProperties: false,
          },
        ],
      },
    },
  },
  events: {},
})
