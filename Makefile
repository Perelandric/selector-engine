SHELL := /bin/bash


# Variables expanded in place
# ===========================

# source files
wrapper_js 	:= src/wrapper.js
exported_js := src/exported.js
lexer_js 		:= src/lexer.js
parser_js 	:= src/parser.js
engine_js 	:= src/engine.js

# test files
test_js			:= test/test.js

# target files
base				:= lib/selector-engine
full				:= $(base).js
compiled		:= $(base).min.js

# compiler settings
debug_mode	:= DEBUG_MODE=false
comp_level	:= WHITESPACE_ONLY
formatting	:= --formatting PRETTY_PRINT


# WOULD NEED A SECTION TO DEFINE DEPENDENCIES.


# Variables expanded at point of use
# ==================================

# closure compiler & gzip commands
closure_params = java -jar '$(CLOSURE)' \
  --js $(exported_js) $(lexer_js) $(parser_js) $(engine_js) \
  --output_wrapper_file $(wrapper_js) \
	--js_output_file $@ \
	--compilation_level $(comp_level) \
	--assume_function_wrapper \
	--define $(debug_mode) \
  --language_in ECMASCRIPT6 \
  --language_out ECMASCRIPT3 \
	$(formatting); \
	gzip --keep --best $@; \
	echo ...$@ complete; \
	echo


# Rules

.PHONY: all test clean


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


$(compiled): $(full) set_advanced
	@echo Compiling $@...
	$(closure_params)


build: $(compiled)


test:
	node $(test_js)


#lint:
#	touch $(full)
#	eslint --quiet --fix $(full)

clean:
	rm -f $(base)*
