SHELL := /bin/bash


# Variables expanded in place
wrapper_js 	:= src/wrapper.js

exported_js := src/exported.js
lexer_js 		:= src/lexer.js
parser_js 	:= src/parser.js
engine_js 	:= src/engine.js

base				:= lib/selector-engine
full				:= $(base).js
compiled		:= $(base).min.js

debug_mode	:= DEBUG_MODE=false
comp_level	:= WHITESPACE_ONLY
formatting	:= --formatting PRETTY_PRINT


# Variables expanded at point of use
closure_params = java -jar '$(CLOSURE)' \
  --js $(exported_js) $(lexer_js) $(parser_js) $(engine_js) \
  --output_wrapper_file $(wrapper_js) \
	--js_output_file $@ \
	--compilation_level $(comp_level) \
	--assume_function_wrapper \
	--define $(debug_mode) \
  --language_in ECMASCRIPT6 \
  --language_out ECMASCRIPT3 \
	$(formatting)

gzip_closure = gzip --keep --best $@; \
	echo ...$@ complete; \
	echo


# Rules

.PHONY: all


all: build


debug: set_debug build


set_debug:
	$(eval debug_mode := DEBUG_MODE=true)


set_advanced:
	$(eval comp_level := ADVANCED)
	$(eval formatting := )


$(full):
	mkdir -p $(dir $@)
	@echo Creating $@...
	$(closure_params)
	$(gzip_closure)


$(compiled): $(full) set_advanced
	@echo Compiling $@...
	$(closure_params)
	$(gzip_closure)


build: $(compiled)


#lint:
#	touch $(full)
#	eslint --quiet --fix $(full)

clean:
	rm -f $(base)*
