SHELL := /bin/bash

wrapper_js 	:= src/wrapper.js

exported_js := src/exported.js
lexer_js 		:= src/lexer.js
parser_js 	:= src/parser.js
engine_js 	:= src/engine.js

base				:= lib/selector-engine
target			:= $(base).js
target_min	:= $(base).min.js

debug_mode	:= DEBUG_MODE=false


.PHONY: all


all: build


debug: set_debug build


set_debug:
	$(eval debug_mode := DEBUG_MODE=true)


$(target): $(wrapper_js)  $(close_js)
	mkdir -p $(dir $@)
	java -jar '$(CLOSURE)' \
  --js $(exported_js) $(lexer_js) $(parser_js) $(engine_js) \
  --js_output_file $@ \
  --output_wrapper_file $(wrapper_js) \
	--assume_function_wrapper \
  --define $(debug_mode) \
  --language_in ECMASCRIPT6 \
  --language_out ECMASCRIPT3 \
  --compilation_level WHITESPACE_ONLY \
  --formatting PRETTY_PRINT
	gzip --keep --best $@


$(target_min): $(target)
	java -jar '$(CLOSURE)' \
  --js $(exported_js) $(lexer_js) $(parser_js) $(engine_js) \
  --js_output_file $(target_min) \
  --output_wrapper_file $(wrapper_js) \
	--assume_function_wrapper \
  --define $(debug_mode) \
  --language_in ECMASCRIPT6 \
  --language_out ECMASCRIPT3 \
  --compilation_level ADVANCED
	gzip --keep --best $@


build: $(target) $(target_min)


#lint:
#	touch $(target)
#	eslint --quiet --fix $(target)

clean:
	rm -f $(base)*
